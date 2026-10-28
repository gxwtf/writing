/**
 * 「AI 学习语料」的共享类型（前端弹窗 / 流式路由共用）。
 *
 * 三类任务共用同一套 SSE 管道，只有 `done` 事件的数据结构不同：
 * - find_words：{ words: AIExtractedWord[] }（沿用 AI 找词）
 * - transfer / summarize：AILearnPayload（判定 + 语块 + 解答 + 分析）
 */

import type { AIExtractedWord, WordDifficulty } from '@/lib/ai-word-prompts';

export type AILearnTask = 'find_words' | 'transfer' | 'summarize';

/** 迁移产物的粒度 */
export type TransferOutputLength = 'paragraph' | 'essay' | 'argument_para';

/** 文体提示：只用于提示词，不做硬校验 */
export type TransferGenre =
  | 'english_essay'
  | 'english_reading'
  | 'chinese_micro_writing'
  | 'chinese_essay'
  | 'chinese_argument'
  | 'other';

export interface AILearnRequest {
  task: AILearnTask;
  entryIds: number[];
  /** find_words 专用 */
  difficulty?: WordDifficulty;
  /** transfer：题目/论点；summarize：可选问题 */
  prompt?: string;
  /** transfer 专用 */
  genre?: TransferGenre;
  outputLength?: TransferOutputLength;
  /** summarize 专用：总结程度，空 = 总结全文 */
  summaryLevel?: string;
}

/** 可迁移语块 */
export interface LearnChunk {
  /** 原文片段（逐字取自语料） */
  text: string;
  /** phrase=词组搭配 / pattern=句式结构 / evidence=论据事实 */
  type: 'phrase' | 'pattern' | 'evidence';
  /** 为什么能迁移到新任务 */
  why: string;
}

/** transfer / summarize 的 `done` 数据 */
export interface AILearnPayload {
  /** ok=有产出；reject=模型判定任务与语料不对应，直接拒绝 */
  verdict: 'ok' | 'reject';
  /** verdict=reject 时必填 */
  rejectReason?: string;
  /** 解答（主输出，纯文本） */
  answer: string;
  /** 分析（次输出）；不需要时模型返回「无分析」 */
  analysis: string;
  /** 仅 transfer 有值 */
  chunks: LearnChunk[];
}

/** `done` 事件的联合载荷 */
export type AILearnDoneData =
  | { words: AIExtractedWord[] }
  | AILearnPayload;

export const NO_ANALYSIS = '无分析';
