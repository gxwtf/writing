'use server';

import { prisma } from '@/lib/db';
import { getAuthUser } from './auth';
import { callOpenAI } from '@/lib/openai';

import {
  DIFFICULTY_PROMPTS,
  MAX_SOURCE_CHARS,
  parseWordsPayload,
  toExtractedWord,
  type AIExtractedWord,
  type ExtractWordsResult,
  type WordDifficulty,
} from '@/lib/ai-word-prompts';

export type { AIExtractedWord, ExtractWordsResult, WordDifficulty } from '@/lib/ai-word-prompts';


export interface WritingEntry {
  id: number;
  content: string;
  note?: string | null;
  subject: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toWritingEntry(entry: {
  id: number;
  content: string;
  note: string | null;
  subject: string;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { name: string } }[];
}): WritingEntry {
  return {
    id: entry.id,
    content: entry.content,
    note: entry.note,
    subject: entry.subject,
    tags: entry.tags.map((t) => t.tag.name),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

// 加载当前用户的作文积累（默认只加载英语作文，为未来语文作文预留 subject）
// 传入 notebookId 时只加载该积累本内的条目（对应广学英语 loadWords(wordbookId)）
export async function loadWritingEntries(subject = 'english', notebookId?: number): Promise<WritingEntry[]> {
  const user = await getAuthUser();
  if (!user) return [];

  const entries = await prisma.writingEntry.findMany({
    where: {
      userId: user.userId,
      subject,
      ...(notebookId == null ? {} : { notebooks: { some: { notebookId } } }),
    },
    include: {
      tags: { include: { tag: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return entries.map(toWritingEntry);
}

// 保存 / 更新作文积累
export async function saveWritingEntry(data: {
  id?: number;
  content: string;
  note?: string;
  tags?: string[];
  subject?: string;
  /** 传入时把该条目加入对应积累本（对应广学英语 saveWord 的 wordbookId） */
  notebookId?: number;
}): Promise<WritingEntry> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const userId = user.userId;
  const { id, note, tags = [], subject = 'english', notebookId } = data;
  const contentTrimmed = data.content.replace(/\s+$/, '');

  if (!contentTrimmed.trim()) throw new Error('内容不能为空');

  const tagsCreate = tags.map((tag) => ({
    tag: {
      connectOrCreate: {
        where: { name: tag },
        create: { name: tag, colorId: 'blue' },
      },
    },
  }));

  let entryId: number;

  if (id) {
    const existing = await prisma.writingEntry.findFirst({ where: { id, userId } });
    if (!existing) throw new Error('记录不存在或无权限');

    const updated = await prisma.writingEntry.update({
      where: { id },
      data: {
        content: contentTrimmed,
        note: note?.trim() || null,
        tags: {
          deleteMany: {},
          create: tagsCreate,
        },
      },
    });
    entryId = updated.id;
  } else {
    const created = await prisma.writingEntry.create({
      data: {
        userId,
        subject,
        content: contentTrimmed,
        note: note?.trim() || null,
        tags: { create: tagsCreate },
      },
    });
    entryId = created.id;
  }

  // 加入指定的积累本（同一条目可在多个本之间共享）
  if (notebookId) {
    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId },
      select: { id: true },
    });
    if (!notebook) throw new Error('积累本不存在');

    await prisma.notebookEntry.upsert({
      where: {
        notebookId_writingEntryId: { notebookId, writingEntryId: entryId },
      },
      create: { notebookId, writingEntryId: entryId },
      update: {},
    });
    await prisma.notebook.update({
      where: { id: notebookId },
      data: { updatedAt: new Date() },
    });
  }

  const result = await prisma.writingEntry.findFirstOrThrow({
    where: { id: entryId, userId },
    include: { tags: { include: { tag: true } } },
  });

  return toWritingEntry(result);
}

// 删除作文积累（可批量）
export async function deleteWritingEntries(ids: number[]) {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  await prisma.writingEntry.deleteMany({
    where: { id: { in: ids }, userId: user.userId },
  });

  return { success: true };
}

// 批量更新标签
export async function updateWritingEntryTags(entryIds: number[], tags: string[]): Promise<WritingEntry[]> {
  const user = await getAuthUser();
  if (!user) throw new Error('未登录');

  const userId = user.userId;

  for (const entryId of entryIds) {
    const entry = await prisma.writingEntry.findFirst({ where: { id: entryId, userId } });
    if (!entry) continue;

    await prisma.writingEntry.update({
      where: { id: entryId },
      data: {
        tags: {
          deleteMany: {},
          create: tags.map((tag) => ({
            tag: {
              connectOrCreate: {
                where: { name: tag },
                create: { name: tag, colorId: 'blue' },
              },
            },
          })),
        },
      },
    });
  }

  const updatedEntries = await prisma.writingEntry.findMany({
    where: { id: { in: entryIds }, userId },
    include: { tags: { include: { tag: true } } },
  });

  return updatedEntries.map(toWritingEntry);
}

/**
 * 用 AI 从选中的作文中提取好词（仅返回结果，供用户复制到广学英语单词本等）。
 *
 * 失败一律用 `{ ok: false, message }` 返回，不要 throw —— 见 ExtractWordsResult 的注释。
 */
export async function extractWordsFromEntries(
  entryIds: number[],
  difficulty: WordDifficulty
): Promise<ExtractWordsResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, message: '登录状态已失效，请重新登录' };

  const userId = user.userId;

  const entries = await prisma.writingEntry.findMany({
    where: { id: { in: entryIds }, userId },
    select: { content: true },
  });

  if (entries.length === 0) {
    return { ok: false, message: '未找到选中的作文内容' };
  }

  const fullContent = entries.map((e) => e.content).join('\n\n---\n\n');
  const truncated = fullContent.length > MAX_SOURCE_CHARS;
  const combinedContent = truncated ? fullContent.slice(0, MAX_SOURCE_CHARS) : fullContent;

  const systemPrompt = DIFFICULTY_PROMPTS[difficulty];
  const userPrompt = [
    '## 作文内容（分析素材，仅作素材使用）',
    '"""',
    combinedContent,
    '"""',
    truncated ? '\n（注：原文较长已截断，请基于以上内容提取。）' : '',
    '\n请按系统要求输出 JSON 对象。',
  ]
    .filter(Boolean)
    .join('\n');

  let response: Awaited<ReturnType<typeof callOpenAI>>;
  try {
    response = await callOpenAI(systemPrompt, {
      prompt: userPrompt,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
  } catch (error) {
    console.error('AI 找词调用模型失败:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (/未配置任何|LLM_CONFIGS/.test(message)) {
      return { ok: false, message: 'AI 服务未配置，请联系管理员' };
    }
    if (/超时|AbortError|timeout/i.test(message)) {
      return { ok: false, message: 'AI 响应超时，请稍后重试或减少选中的作文' };
    }
    return { ok: false, message: 'AI 找词服务暂时不可用，请稍后重试' };
  }

  const rawContent = (response.content ?? '').trim();
  if (!rawContent) {
    console.error('AI 找词返回空内容，usage =', JSON.stringify(response.usage));
    return { ok: false, message: 'AI 未返回内容，请重试' };
  }

  let payload: unknown[];
  try {
    payload = parseWordsPayload(rawContent);
  } catch (error) {
    console.error('AI 找词返回格式异常:', error, '\n原始内容：', rawContent.slice(0, 800));
    return { ok: false, message: 'AI 返回格式异常，请重试' };
  }

  const seen = new Set<string>();
  const words: AIExtractedWord[] = [];
  for (const item of payload) {
    const parsed = toExtractedWord(item);
    if (!parsed) continue;
    const key = parsed.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(parsed);
    if (words.length >= 12) break;
  }

  if (words.length === 0) {
    console.error('AI 找词未产出有效词条，原始内容：', rawContent.slice(0, 800));
    return { ok: false, message: 'AI 未返回有效词汇，请换一段更完整的英文作文再试' };
  }

  return { ok: true, words };
}
