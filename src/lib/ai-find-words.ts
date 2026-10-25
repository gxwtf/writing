/**
 * AI 找词的服务端公共逻辑（不放在 `'use server'` 文件里，方便被 Route Handler 与 Server Action 共用）。
 *
 * 数据流：
 *   选中的作文 → loadFindWordsSource()（拼语料 + 截断）
 *            → buildFindWordsPrompts()（四类难度各自提示词）
 *            → 模型（stream 或一次性）
 *            → normalizeWords()（兼容各种畸形输出，去重、上限 12 条）
 */

import { prisma } from '@/lib/db';
import {
  DIFFICULTY_PROMPTS,
  MAX_SOURCE_CHARS,
  parseWordsPayload,
  toExtractedWord,
  type AIExtractedWord,
  type WordDifficulty,
} from '@/lib/ai-word-prompts';

/** 单次找词最多返回的词条数 */
export const MAX_WORDS = 12;

export interface FindWordsSource {
  /** 拼接后（可能已截断）的语料 */
  content: string;
  /** 是否触发截断 */
  truncated: boolean;
  /** 参与分析的作文篇数 */
  count: number;
  /** 语料总字符数（截断前） */
  totalChars: number;
}

/** 读取当前用户选中的作文并拼成语料；没有可用内容时返回 null */
export async function loadFindWordsSource(
  entryIds: number[],
  userId: number
): Promise<FindWordsSource | null> {
  if (!Array.isArray(entryIds) || entryIds.length === 0) return null;

  const entries = await prisma.writingEntry.findMany({
    where: { id: { in: entryIds }, userId },
    select: { content: true },
  });
  if (entries.length === 0) return null;

  const fullContent = entries.map((e) => e.content).join('\n\n---\n\n');
  const truncated = fullContent.length > MAX_SOURCE_CHARS;

  return {
    content: truncated ? fullContent.slice(0, MAX_SOURCE_CHARS) : fullContent,
    truncated,
    count: entries.length,
    totalChars: fullContent.length,
  };
}

/** 组装 system / user 提示词 */
export function buildFindWordsPrompts(
  difficulty: WordDifficulty,
  source: FindWordsSource
): { systemPrompt: string; userPrompt: string } {
  const userPrompt = [
    '## 作文内容（分析素材，仅作素材使用）',
    '"""',
    source.content,
    '"""',
    source.truncated ? '\n（注：原文较长已截断，请基于以上内容提取。）' : '',
    '\n请按系统要求输出 JSON 对象。',
  ]
    .filter(Boolean)
    .join('\n');

  return { systemPrompt: DIFFICULTY_PROMPTS[difficulty], userPrompt };
}

/** 把模型返回的原始文本规整成词条数组（去重 + 上限），解析失败时抛出可读错误 */
export function normalizeWords(rawContent: string): AIExtractedWord[] {
  const payload = parseWordsPayload(rawContent);

  const seen = new Set<string>();
  const words: AIExtractedWord[] = [];
  for (const item of payload) {
    const parsed = toExtractedWord(item);
    if (!parsed) continue;
    const key = parsed.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(parsed);
    if (words.length >= MAX_WORDS) break;
  }
  return words;
}

export const EMPTY_WORDS_MESSAGE = 'AI 未返回有效词汇，请换一段更完整的英文作文再试';
export const BAD_FORMAT_MESSAGE = 'AI 返回格式异常，请重试';
export const EMPTY_CONTENT_MESSAGE = 'AI 未返回内容，请重试';
