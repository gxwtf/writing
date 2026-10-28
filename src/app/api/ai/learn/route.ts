/**
 * AI 学习语料（流式）—— `POST /api/ai/learn`
 *
 * 三类任务共用同一条 SSE 管道，靠 `task` 分发：
 *   find_words  找词（原有能力，词条卡片）
 *   transfer    迁移应用（判定能否迁移 → 可迁移语块 → 迁移示例）
 *   summarize   总结分析（总结程度 / 指定问题 → 解答 + 分析）
 *
 * 事件：meta → thinking* → delta* → usage* → done | error
 *   find_words 的 done：{ words: AIExtractedWord[] }
 *   transfer / summarize 的 done：{ verdict, rejectReason?, answer, analysis, chunks }
 *
 * 模型来源（优先级由 lib/openai.ts 统一处理）：显式传参 > 用户 BYOK > 系统默认 LLM_CONFIGS。
 * 目前**不做限流**（按需求），只做入参上限与超时看门狗。
 */

import { getAuthUser } from '@/actions/auth';
import {
  buildFindWordsPrompts,
  loadFindWordsSource,
  normalizeWords,
  EMPTY_WORDS_MESSAGE,
  BAD_FORMAT_MESSAGE,
  EMPTY_CONTENT_MESSAGE,
} from '@/lib/ai-find-words';
import { buildSummarizePrompts, buildTransferPrompts, normalizeLearnPayload } from '@/lib/ai-learn-prompts';
import type { AILearnRequest, TransferGenre, TransferOutputLength } from '@/lib/ai-learn-types';
import type { WordDifficulty } from '@/lib/ai-word-prompts';
import { streamChatCompletion } from '@/lib/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TASKS = ['find_words', 'transfer', 'summarize'] as const;
const VALID_DIFFICULTIES: WordDifficulty[] = ['replace', 'gaokao', 'writing', 'extensive'];
const VALID_GENRES: TransferGenre[] = [
  'english_essay',
  'english_reading',
  'chinese_micro_writing',
  'chinese_essay',
  'chinese_argument',
  'other',
];
const VALID_LENGTHS: TransferOutputLength[] = ['paragraph', 'essay', 'argument_para'];

/** 入参上限（防滥用：不做限流，但限制单次规模） */
const MAX_ENTRY_IDS = 20;
const MAX_PROMPT_CHARS = 2000;
const MAX_SUMMARY_LEVEL_CHARS = 500;

const FIRST_TOKEN_TIMEOUT_MS = 45_000;
const IDLE_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 150_000;

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/未配置任何|LLM_CONFIGS/.test(message)) return 'AI 服务未配置，请联系管理员';
  if (/超时|AbortError|timeout|TIMEOUT/i.test(message)) return 'AI 响应超时，请稍后重试或减少选中的作文';
  if (/401|403|Unauthorized|invalid_api_key/i.test(message)) return '自定义模型的 API Key 无效或额度不足，请在「设置 → AI 学习语料设置」中检查';
  if (/404|model_not_found|does not exist/i.test(message)) return '自定义模型不存在或 API Base 填错，请在设置中检查';
  return 'AI 服务暂时不可用，请稍后重试';
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ ok: false, message: '登录状态已失效，请重新登录' }, { status: 401 });
  }

  let body: Partial<AILearnRequest> & { entryIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const task = body.task as (typeof VALID_TASKS)[number];
  if (!VALID_TASKS.includes(task)) {
    return Response.json({ ok: false, message: '未知的 AI 任务类型' }, { status: 400 });
  }

  const entryIds = Array.isArray(body.entryIds)
    ? body.entryIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (entryIds.length === 0) {
    return Response.json({ ok: false, message: '请先选择语料' }, { status: 400 });
  }
  if (entryIds.length > MAX_ENTRY_IDS) {
    return Response.json({ ok: false, message: `一次最多选择 ${MAX_ENTRY_IDS} 条语料` }, { status: 400 });
  }

  const prompt = (body.prompt ?? '').trim();
  const summaryLevel = (body.summaryLevel ?? '').trim();
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json({ ok: false, message: `题目/问题请控制在 ${MAX_PROMPT_CHARS} 字以内` }, { status: 400 });
  }
  if (summaryLevel.length > MAX_SUMMARY_LEVEL_CHARS) {
    return Response.json({ ok: false, message: `总结程度请控制在 ${MAX_SUMMARY_LEVEL_CHARS} 字以内` }, { status: 400 });
  }
  if (task === 'transfer' && prompt.length < 4) {
    return Response.json({ ok: false, message: '请填写要迁移到的新题目或论点' }, { status: 400 });
  }

  const difficulty = body.difficulty as WordDifficulty;
  if (task === 'find_words' && !VALID_DIFFICULTIES.includes(difficulty)) {
    return Response.json({ ok: false, message: '未知的找词难度' }, { status: 400 });
  }

  const genre = VALID_GENRES.includes(body.genre as TransferGenre) ? (body.genre as TransferGenre) : undefined;
  const outputLength = VALID_LENGTHS.includes(body.outputLength as TransferOutputLength)
    ? (body.outputLength as TransferOutputLength)
    : undefined;

  const source = await loadFindWordsSource(entryIds, user.userId);
  if (!source) {
    return Response.json({ ok: false, message: '未找到选中的语料内容' }, { status: 404 });
  }

  const { systemPrompt, userPrompt } =
    task === 'find_words'
      ? buildFindWordsPrompts(difficulty, source)
      : task === 'transfer'
        ? buildTransferPrompts(source, { prompt, genre, outputLength })
        : buildSummarizePrompts(source, { question: prompt, summaryLevel });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sse(event, data));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      };

      let content = '';
      let thinkingChars = 0;
      const startedAt = Date.now();

      try {
        const { response, config } = await streamChatCompletion(systemPrompt, userPrompt, {
          temperature: 0.3,
          response_format: { type: 'json_object' },
        });

        send('meta', {
          task,
          difficulty: task === 'find_words' ? difficulty : undefined,
          count: source.count,
          totalChars: source.totalChars,
          truncated: source.truncated,
          model: config.model,
          usingUserModel: config.name === 'user-custom',
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawContent = false;

        let timer: ReturnType<typeof setTimeout> | null = null;
        const arm = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            send('error', { message: 'AI 响应超时，请稍后重试' });
            finish();
            reader.cancel().catch(() => {});
          }, sawContent ? IDLE_TIMEOUT_MS : FIRST_TOKEN_TIMEOUT_MS);
        };
        arm();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
            send('error', { message: 'AI 生成超时（超过 150 秒），请减少选中的语料或稍后重试' });
            finish();
            reader.cancel().catch(() => {});
            return;
          }
          if (timer) clearTimeout(timer);
          arm();

          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              let parsed: {
                choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[];
                usage?: Record<string, number>;
              };
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              const delta = parsed.choices?.[0]?.delta;
              const reasoning = delta?.reasoning_content || delta?.reasoning;
              if (reasoning) {
                thinkingChars += reasoning.length;
                send('thinking', { text: reasoning });
              }
              if (delta?.content) {
                sawContent = true;
                content += delta.content;
                send('delta', { text: delta.content });
              }
              if (parsed.usage) send('usage', parsed.usage);
            }
          }
        }
        if (timer) clearTimeout(timer);

        if (!content.trim()) {
          console.error(`流式学习语料[${task}]：上游未返回正文，thinkingChars =`, thinkingChars);
          send('error', { message: EMPTY_CONTENT_MESSAGE });
          finish();
          return;
        }

        if (task === 'find_words') {
          let words;
          try {
            words = normalizeWords(content);
          } catch (error) {
            console.error('流式找词：JSON 解析失败', error, '\n原始内容：', content.slice(0, 800));
            send('error', { message: BAD_FORMAT_MESSAGE });
            finish();
            return;
          }
          if (words.length === 0) {
            console.error('流式找词：解析出 0 条词条，原始内容：', content.slice(0, 800));
            send('error', { message: EMPTY_WORDS_MESSAGE });
            finish();
            return;
          }
          send('done', { words });
          finish();
          return;
        }

        let payload;
        try {
          payload = normalizeLearnPayload(content);
        } catch (error) {
          console.error(`流式学习语料[${task}]：解析失败`, error, '\n原始内容：', content.slice(0, 800));
          send('error', { message: BAD_FORMAT_MESSAGE });
          finish();
          return;
        }

        send('done', payload);
        finish();
      } catch (error) {
        console.error(`流式学习语料[${task}]失败:`, error);
        send('error', { message: friendlyError(error) });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
