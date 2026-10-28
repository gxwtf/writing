'use server';

import { prisma } from '@/lib/db';
import { getAuthUser } from './auth';
import { callOpenAI } from '@/lib/openai';

import { type AIExtractedWord, type ExtractWordsResult, type WordDifficulty } from '@/lib/ai-word-prompts';
import {
  buildFindWordsPrompts,
  loadFindWordsSource,
  normalizeWords,
  BAD_FORMAT_MESSAGE,
  EMPTY_CONTENT_MESSAGE,
  EMPTY_WORDS_MESSAGE,
} from '@/lib/ai-find-words';

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
 * 把「AI 学习语料」的解答一键存成一条积累。
 *
 * 只存解答（不含分析），note 用来标注来源任务，方便在列表里分辨；
 * notebookId 有值时同时加入该积累本（见 saveWritingEntry）。
 */
export async function saveAIAnswer(input: {
  content: string;
  note?: string;
  notebookId?: number;
}): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const content = (input.content ?? '').trim();
  if (!content) return { ok: false, message: '没有可保存的内容' };

  try {
    const entry = await saveWritingEntry({
      content,
      note: input.note?.trim() || undefined,
      notebookId: input.notebookId,
    });
    return { ok: true, id: entry.id };
  } catch (error) {
    console.error('保存 AI 解答失败:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (/未登录/.test(message)) return { ok: false, message: '登录状态已失效，请重新登录' };
    return { ok: false, message: '保存失败，请稍后重试' };
  }
}

/**
 * 用 AI 从选中的作文中提取好词（**非流式**，保留供脚本/降级调用）。
 *
 * 页面上的「AI 学习语料」走的是流式接口 `POST /api/ai/learn`（见 app/api/ai/learn/route.ts），
 * 因为它能在生成过程中给前端反馈；这个 Server Action 只做一次性返回（找词兜底）。
 * 失败一律用 `{ ok: false, message }` 返回，不要 throw —— 见 ExtractWordsResult 的注释。
 */
export async function extractWordsFromEntries(
  entryIds: number[],
  difficulty: WordDifficulty
): Promise<ExtractWordsResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, message: '登录状态已失效，请重新登录' };

  const source = await loadFindWordsSource(entryIds, user.userId);
  if (!source) return { ok: false, message: '未找到选中的作文内容' };

  const { systemPrompt, userPrompt } = buildFindWordsPrompts(difficulty, source);

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
    return { ok: false, message: EMPTY_CONTENT_MESSAGE };
  }

  let words;
  try {
    words = normalizeWords(rawContent);
  } catch (error) {
    console.error('AI 找词返回格式异常:', error, '\n原始内容：', rawContent.slice(0, 800));
    return { ok: false, message: BAD_FORMAT_MESSAGE };
  }

  if (words.length === 0) {
    console.error('AI 找词未产出有效词条，原始内容：', rawContent.slice(0, 800));
    return { ok: false, message: EMPTY_WORDS_MESSAGE };
  }

  return { ok: true, words };
}
