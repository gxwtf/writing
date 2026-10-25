/**
 * AI 找词（流式）—— `POST /api/ai/find-words`
 *
 * 为什么用 Route Handler 而不是 Server Action：
 * Server Action 是一次性返回的，前端在 10~30s 里完全没反馈；这里改成 SSE 流式转发，
 * 前端能立刻显示「思考过程 / JSON 生成过程」，并且**首字节早、后续持续有数据**，
 * 不会撞上 nginx 默认的 `proxy_read_timeout 60s`（那是「两次读之间」的超时，不是总时长）。
 *
 * 请求：{ entryIds: number[], difficulty: 'replace' | 'gaokao' | 'writing' | 'extensive' }
 * 响应：text/event-stream，事件依次为
 *   meta   { difficulty, count, totalChars, truncated, model }
 *   thinking { text }   模型思考片段（reasoning_content，可能没有）
 *   delta  { text }     正文片段（就是 {"words": [...]} 的生成过程）
 *   usage  {...}        token 用量（上游支持时）
 *   done   { words: AIExtractedWord[] }
 *   error  { message }
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
import { streamChatCompletion } from '@/lib/openai';
import type { WordDifficulty } from '@/lib/ai-word-prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DIFFICULTIES: WordDifficulty[] = ['replace', 'gaokao', 'writing', 'extensive'];

/** 首包超时：上游连上后迟迟不吐字就当作失败 */
const FIRST_TOKEN_TIMEOUT_MS = 45_000;
/** 空闲超时：两片之间超过这个时间就断开（比 nginx 的 60s 留出余量） */
const IDLE_TIMEOUT_MS = 45_000;
/**
 * 总时长上限。流式之后不再受 nginx 60s 整包超时限制，但 reasoning 模型的思考时长
 * 波动很大（实测同一模型 10s~130s+），必须有一道总闸，否则极端情况会一直挂着。
 */
const TOTAL_TIMEOUT_MS = 150_000;

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function errMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/未配置任何|LLM_CONFIGS/.test(message)) return 'AI 服务未配置，请联系管理员';
  if (/超时|AbortError|timeout|TIMEOUT/i.test(message)) return 'AI 响应超时，请稍后重试或减少选中的作文';
  return 'AI 找词服务暂时不可用，请稍后重试';
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ ok: false, message: '登录状态已失效，请重新登录' }, { status: 401 });
  }

  let payload: { entryIds?: unknown; difficulty?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const entryIds = Array.isArray(payload.entryIds)
    ? payload.entryIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const difficulty = payload.difficulty as WordDifficulty;

  if (entryIds.length === 0) {
    return Response.json({ ok: false, message: '请先选择要分析的作文' }, { status: 400 });
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return Response.json({ ok: false, message: '未知的找词难度' }, { status: 400 });
  }

  const source = await loadFindWordsSource(entryIds, user.userId);
  if (!source) {
    return Response.json({ ok: false, message: '未找到选中的作文内容' }, { status: 404 });
  }

  const { systemPrompt, userPrompt } = buildFindWordsPrompts(difficulty, source);

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
          difficulty,
          count: source.count,
          totalChars: source.totalChars,
          truncated: source.truncated,
          model: config.model,
        });

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawContent = false;

        // 空闲看门狗：任意一片数据到达就重置
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
            send('error', { message: 'AI 生成超时（超过 150 秒），请减少选中的作文或稍后重试' });
            finish();
            reader.cancel().catch(() => {});
            return;
          }
          if (timer) clearTimeout(timer);
          arm();

          buffer += decoder.decode(value, { stream: true });

          // 上游 SSE 以空行分隔事件
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
          console.error('流式找词：上游未返回正文，thinkingChars =', thinkingChars);
          send('error', { message: EMPTY_CONTENT_MESSAGE });
          finish();
          return;
        }

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
      } catch (error) {
        console.error('流式找词失败:', error);
        send('error', { message: errMessage(error) });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // 关键：让 nginx 不要缓冲这条响应，否则前端要等整段生成完才看到内容
      'X-Accel-Buffering': 'no',
    },
  });
}
