'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Check, Sparkles, ClipboardList, Loader2, ArrowUpDown, GraduationCap,
  Feather, Globe, RotateCcw, AlertTriangle, Square, BookMarked, Wand2, AlignLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { saveAIAnswer } from '@/actions/writing-entries';
import type { AIExtractedWord, WordDifficulty } from '@/actions/writing-entries';
import { NO_ANALYSIS, type AILearnPayload, type AILearnTask, type TransferGenre, type TransferOutputLength } from '@/lib/ai-learn-types';

interface AILearnDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 选中的语料 id */
  entryIds: number[];
  /** 当前所在积累本（在「所有积累」里为 undefined） */
  notebookId?: number;
  /** 存入成功后通知父组件刷新列表 */
  onSaved?: () => void;
}

type Phase = 'form' | 'running' | 'result' | 'error';

const TASKS: { id: AILearnTask; title: string; hint: string; icon: typeof Sparkles }[] = [
  { id: 'find_words', title: '找词', hint: '从语料里提取值得积累的词', icon: Sparkles },
  { id: 'transfer', title: '迁移应用', hint: '把语料用到新题目上', icon: Wand2 },
  { id: 'summarize', title: '总结分析', hint: '总结要点或按问题提取', icon: AlignLeft },
];

const DIFFICULTIES: { id: WordDifficulty; title: string; description: string; icon: typeof Sparkles }[] = [
  { id: 'replace', title: '常用单词替换词', description: '挑出原文里的好词，看它能替换掉哪些你常用的简单词', icon: ArrowUpDown },
  { id: 'gaokao', title: '高考核心词汇', description: '高考 3500 词中的高频重点词汇，夯实基础应对考试', icon: GraduationCap },
  { id: 'writing', title: '写作高级表达', description: '适合书面表达的高级句型和词汇搭配，提升作文档次', icon: Feather },
  { id: 'extensive', title: '外刊拓展词汇', description: '课标外但常出现于外刊的词汇，拓展阅读能力', icon: Globe },
];

const GENRES: { id: TransferGenre; label: string }[] = [
  { id: 'english_essay', label: '英语大作文' },
  { id: 'english_reading', label: '英语阅读表达' },
  { id: 'chinese_micro_writing', label: '语文微写作' },
  { id: 'chinese_essay', label: '语文大作文' },
  { id: 'chinese_argument', label: '议论文论点' },
  { id: 'other', label: '其他' },
];

const OUTPUT_LENGTHS: { id: TransferOutputLength; label: string; hint: string }[] = [
  { id: 'paragraph', label: '核心段', hint: '可直接放进作文的中心段' },
  { id: 'essay', label: '完整文章', hint: '整篇成文' },
  { id: 'argument_para', label: '一段论述', hint: '观点+论据+分析' },
];

/**
 * AI 学习语料：找词 / 迁移应用 / 总结分析。
 *
 * 三个任务同一个弹窗、同一套流式管道（POST /api/ai/learn）：
 * 选参数 → 生成中（进度条 + 三步 + 实时思考/JSON 流）→ 结果（或模型判定「不匹配」的拒答态）。
 * 迁移/总结的「解答」可一键存入当前积累本；找词仍只提供复制。
 */
export const AILearnDialog = ({ isOpen, onClose, entryIds, notebookId, onSaved }: AILearnDialogProps) => {
  const [task, setTask] = useState<AILearnTask>('find_words');
  const [phase, setPhase] = useState<Phase>('form');

  // 表单参数
  const [difficulty, setDifficulty] = useState<WordDifficulty | null>('replace');
  const [topic, setTopic] = useState('');
  const [genre, setGenre] = useState<TransferGenre>('english_essay');
  const [outputLength, setOutputLength] = useState<TransferOutputLength>('paragraph');
  const [summaryLevel, setSummaryLevel] = useState('');
  const [question, setQuestion] = useState('');

  // 结果
  const [words, setWords] = useState<AIExtractedWord[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [payload, setPayload] = useState<AILearnPayload | null>(null);

  // 过程态
  const [errorMessage, setErrorMessage] = useState('');
  const [thinking, setThinking] = useState('');
  const [thinkingTotal, setThinkingTotal] = useState(0);
  const [draftJson, setDraftJson] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [thinkOpen, setThinkOpen] = useState(true);
  const [meta, setMeta] = useState<{ count?: number; model?: string; usingUserModel?: boolean }>({});

  // 复制 / 保存
  const [copied, setCopied] = useState<'answer' | 'all' | 'words' | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLPreElement | null>(null);
  const startedAtRef = useRef<number>(0);

  const resetRunState = useCallback(() => {
    setWords([]);
    setSelectedIndices([]);
    setPayload(null);
    setErrorMessage('');
    setThinking('');
    setThinkingTotal(0);
    setDraftJson('');
    setElapsedMs(0);
    setMeta({});
    setCopied(null);
    setSavedId(null);
    setThinkOpen(true);
  }, []);

  // 每次打开回到表单；关闭时中断请求
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    resetRunState();
    setPhase('form');
  }, [isOpen, resetRunState]);

  // 计时器
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    return () => clearInterval(timer);
  }, [phase]);

  // 流式文本自动到底
  useEffect(() => {
    const box = streamBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [draftJson, thinking]);

  const handleEvent = useCallback((raw: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;

    let data: {
      text?: string; words?: AIExtractedWord[]; message?: string; count?: number; model?: string;
      usingUserModel?: boolean; verdict?: 'ok' | 'reject'; rejectReason?: string; answer?: string;
      analysis?: string; chunks?: AILearnPayload['chunks'];
    };
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    if (event === 'meta') {
      setMeta({ count: data.count, model: data.model, usingUserModel: data.usingUserModel });
    } else if (event === 'thinking') {
      setThinkingTotal((n) => n + (data.text ?? '').length);
      setThinking((prev) => (prev + (data.text ?? '')).slice(-4000));
    } else if (event === 'delta') {
      setDraftJson((prev) => (prev + (data.text ?? '')).slice(-8000));
    } else if (event === 'done') {
      if (Array.isArray(data.words)) {
        setWords(data.words);
        setSelectedIndices(data.words.map((_, i) => i));
      } else {
        setPayload({
          verdict: data.verdict === 'reject' ? 'reject' : 'ok',
          rejectReason: data.rejectReason ?? '',
          answer: data.answer ?? '',
          analysis: data.analysis || NO_ANALYSIS,
          chunks: data.chunks ?? [],
        });
      }
      setPhase('result');
    } else if (event === 'error') {
      setErrorMessage(data.message || 'AI 任务失败，请重试');
      setPhase('error');
    }
  }, []);

  const buildBody = useCallback(() => {
    if (task === 'find_words') {
      return { task, entryIds, difficulty: difficulty ?? 'replace' };
    }
    if (task === 'transfer') {
      return { task, entryIds, prompt: topic.trim(), genre, outputLength };
    }
    return { task, entryIds, prompt: question.trim(), summaryLevel: summaryLevel.trim() };
  }, [task, entryIds, difficulty, topic, genre, outputLength, question, summaryLevel]);

  const canRun = (() => {
    if (entryIds.length === 0) return false;
    if (task === 'transfer') return topic.trim().length >= 4;
    return true;
  })();

  const run = useCallback(async () => {
    if (!canRun) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    resetRunState();
    setPhase('running');
    startedAtRef.current = Date.now();

    try {
      const res = await fetch('/api/ai/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        setErrorMessage((detail as { message?: string } | null)?.message || 'AI 服务暂时不可用，请稍后重试');
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleEvent(chunk);
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        setPhase('form');
        return;
      }
      console.error('AI 学习语料失败:', error);
      setErrorMessage('网络中断，请重试');
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [canRun, buildBody, handleEvent, resetRunState]);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('form');
  };

  const toggleSelectAll = () => {
    setSelectedIndices((prev) => (prev.length === words.length ? [] : words.map((_, i) => i)));
  };
  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  };
  const selectedWords = words.filter((_, i) => selectedIndices.includes(i));

  const copyText = async (text: string, kind: 'answer' | 'all' | 'words') => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  const noteForSave = () => {
    const head = (task === 'transfer' ? topic : question || summaryLevel || '全文').trim().slice(0, 30);
    return `${task === 'transfer' ? 'AI迁移应用' : 'AI总结分析'} · ${head}`;
  };

  const handleSave = async () => {
    if (!payload || payload.verdict !== 'ok' || !payload.answer) return;
    setSaving(true);
    try {
      const result = await saveAIAnswer({ content: payload.answer, note: noteForSave(), notebookId });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }
      setSavedId(result.id);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const subtitle = (() => {
    if (phase === 'running') {
      const stage = !meta.model ? '读取语料' : draftJson ? '校验整理' : '生成内容';
      return `${meta.count ? `正在分析 ${meta.count} 条语料` : '正在分析语料'} · ${stage} · 已用 ${(elapsedMs / 1000).toFixed(1)}s`;
    }
    if (phase === 'result') {
      if (payload) return payload.verdict === 'reject' ? '这段语料与任务不匹配' : '已完成，可复制或存入积累本';
      return `共找到 ${words.length} 个好词，已选择 ${selectedIndices.length} 个`;
    }
    if (phase === 'error') return '本次没有取到结果';
    return '找词 / 迁移应用 / 总结分析，都基于你选中的语料';
  })();

  const stepIndex = phase === 'result' ? 3 : !meta.model ? 1 : draftJson ? 3 : 2;
  const taskHint = TASKS.find((t) => t.id === task)?.hint ?? '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-purple-50/70 p-5 dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">AI 学习语料</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600 tabular-nums dark:text-gray-400">{subtitle}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭" className="h-9 w-9 shrink-0 p-2">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 页签（只在表单阶段显示，避免生成中误切换） */}
        {phase === 'form' && (
          <div className="flex gap-1 border-b border-gray-200 bg-white px-3 pt-2 dark:border-gray-700 dark:bg-gray-900 sm:px-5">
            {TASKS.map((t) => {
              const Icon = t.icon;
              const active = task === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTask(t.id); resetRunState(); }}
                  className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'border-b-2 border-brand-crimson font-semibold text-brand-crimson'
                      : 'border-b-2 border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {t.title}
                </button>
              );
            })}
          </div>
        )}

        <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto p-4 sm:p-6">
          {/* ---------- 表单 ---------- */}
          {phase === 'form' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {taskHint} · 已选 {entryIds.length} 条语料{notebookId ? ' · 结果可存入当前积累本' : ''}
              </p>

              {task === 'find_words' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DIFFICULTIES.map((option) => {
                    const Icon = option.icon;
                    const isSelected = difficulty === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setDifficulty(option.id)}
                        className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:p-4 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300/60'
                            : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white dark:border-gray-600 dark:bg-gray-700'
                        }`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${isSelected ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-purple-600 dark:border-gray-500 dark:bg-gray-800'}`}>
                          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{option.title}</div>
                          <div className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{option.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {task === 'transfer' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ai-topic">要迁移到的新题目 / 论点（必填）</Label>
                    <Textarea
                      id="ai-topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value.slice(0, 2000))}
                      rows={4}
                      placeholder="例如：有些人认为科技让人变懒，请就此写一篇英语议论文的第三段；或：论点「真正的自律来自内在动机」"
                    />
                    <div className="text-right text-xs text-gray-400">{topic.length} / 2000</div>
                  </div>

                  <div className="space-y-2">
                    <Label>文体（只影响提示词）</Label>
                    <div className="flex flex-wrap gap-2">
                      {GENRES.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGenre(g.id)}
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            genre === g.id
                              ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>产出粒度</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {OUTPUT_LENGTHS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setOutputLength(l.id)}
                          className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                            outputLength === l.id
                              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300'
                              : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          <div className="text-xs font-medium text-gray-900 dark:text-white">{l.label}</div>
                          <div className="mt-0.5 text-[11px] leading-tight text-gray-500 dark:text-gray-400">{l.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {task === 'summarize' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ai-level">总结程度（可留空 = 总结全文）</Label>
                    <Input
                      id="ai-level"
                      value={summaryLevel}
                      onChange={(e) => setSummaryLevel(e.target.value.slice(0, 500))}
                      placeholder="例如：3 句话 / 200 字左右 / 分条列出 / 只保留数据与结论"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-question">指定问题（可选，像阅读解答题那样提问）</Label>
                    <Textarea
                      id="ai-question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value.slice(0, 2000))}
                      rows={3}
                      placeholder="例如：作者为什么反对把阅读等同于做题？请用原文依据回答。"
                    />
                    <div className="text-right text-xs text-gray-400">{question.length} / 2000</div>
                  </div>
                </div>
              )}

              <Button
                onClick={run}
                disabled={!canRun}
                className="h-auto w-full rounded-lg bg-gradient-to-r from-brand-crimson to-brand-deep-red py-3 font-semibold text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl"
              >
                {task === 'find_words' ? '开始找词' : task === 'transfer' ? '开始迁移' : '开始总结'}
              </Button>
            </div>
          )}

          {/* ---------- 生成中 ---------- */}
          {phase === 'running' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-gray-600 dark:bg-gray-700/60">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-purple-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    AI 正在处理「{TASKS.find((t) => t.id === task)?.title}」…
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {elapsedMs > 45_000
                      ? '本次模型耗时较久（已超过 45 秒），可以继续等，或点「停止」换个任务重试'
                      : '通常需要 10~30 秒；可以先看下面的思考与生成过程'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={cancel} className="shrink-0 gap-1.5" title="停止本次任务">
                  <Square className="h-3.5 w-3.5" /> 停止
                </Button>
              </div>

              <div className="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-label="生成中">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-crimson" />
              </div>

              <ol className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {[
                  { short: '语料', long: '读取语料' },
                  { short: '生成', long: '生成内容' },
                  { short: '校验', long: '校验整理' },
                ].map(({ short, long }, i) => {
                  const done = i < stepIndex - 1;
                  const active = i === stepIndex - 1;
                  return (
                    <li key={long} className="flex flex-1 items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${done ? 'bg-brand-crimson text-white' : active ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className={`whitespace-nowrap ${active ? 'font-medium text-gray-700 dark:text-gray-200' : ''}`}>
                        <span className="sm:hidden">{short}</span>
                        <span className="hidden sm:inline">{long}</span>
                      </span>
                      {i < 2 && <span className="hidden flex-1 border-t border-dashed border-gray-300 sm:block" />}
                    </li>
                  );
                })}
              </ol>

              {thinking && (
                <details
                  open={thinkOpen}
                  onToggle={(e) => setThinkOpen((e.currentTarget as HTMLDetailsElement).open)}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">
                    AI 思考过程 · 实时 {thinkingTotal} 字
                  </summary>
                  <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    {thinking}
                  </pre>
                </details>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>生成的内容</span>
                  <span className="tabular-nums">{draftJson.length} 字</span>
                </div>
                <pre
                  ref={streamBoxRef}
                  className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  {draftJson || (thinking ? '模型正在思考（见上方），思考结束后会输出 JSON…' : `正在连接模型，等待首个 token…（已等 ${(elapsedMs / 1000).toFixed(0)}s）`)}
                </pre>
              </div>
            </div>
          )}

          {/* ---------- 结果：找词 ---------- */}
          {phase === 'result' && !payload && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                  <Checkbox checked={selectedIndices.length === words.length} onCheckedChange={toggleSelectAll} />
                  <span className="whitespace-nowrap">{selectedIndices.length === words.length ? '取消全选' : '全选'}</span>
                </button>
                <span className="whitespace-nowrap text-sm text-gray-500 tabular-nums dark:text-gray-400">
                  {selectedIndices.length} / {words.length}
                </span>
              </div>

              <div className="space-y-3">
                {words.map((word, index) => (
                  <div key={`${word.word}-${index}`} className={`rounded-xl border p-4 transition-colors ${selectedIndices.includes(index) ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
                    <div className="flex items-start gap-3">
                      <Checkbox checked={selectedIndices.includes(index)} onCheckedChange={() => toggleSelect(index)} className="mt-1 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-base font-bold break-words text-gray-900 dark:text-white sm:text-lg">{word.word}</span>
                          <Badge variant="selected" className="border-gray-300 bg-gray-100 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">{word.type}</Badge>
                          {word.replaceWord && (
                            <Badge variant="selected" className="border-blue-200 bg-blue-50 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200">代替 {word.replaceWord}</Badge>
                          )}
                          {word.difficultyTag && (
                            <Badge variant="selected" className="border-amber-200 bg-amber-50 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{word.difficultyTag}</Badge>
                          )}
                          {word.sourceDomain && (
                            <Badge variant="selected" className="border-indigo-200 bg-indigo-50 text-xs text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">{word.sourceDomain}</Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed break-words text-gray-700 dark:text-gray-200">{word.meaning}</p>
                        {word.sentence && (
                          <p className="mt-2 text-sm leading-relaxed break-words text-gray-600 italic dark:text-gray-400">例句: {word.sentence}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------- 结果：迁移/总结（含拒答） ---------- */}
          {phase === 'result' && payload && payload.verdict === 'reject' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">这段语料与任务对不上</div>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{payload.rejectReason}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setPhase('form')} className="w-full sm:w-auto">换一个题目</Button>
                <Button onClick={run} className="w-full gap-1.5 border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg hover:from-brand-red hover:to-brand-deep-red sm:w-auto">
                  <RotateCcw className="h-4 w-4" /> 重试
                </Button>
              </div>
            </div>
          )}

          {phase === 'result' && payload && payload.verdict === 'ok' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                  <Check className="h-3.5 w-3.5 text-brand-crimson" /> 解答
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                  {payload.answer}
                </div>
              </div>

              {payload.chunks.length === 0 && task === 'transfer' && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  本次模型没有单独列出可迁移语块，可直接使用下面的解答；想更细可以重试一次。
                </p>
              )}

              {payload.chunks.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                    可迁移语块（{payload.chunks.length}）
                  </div>
                  <ul className="space-y-2">
                    {payload.chunks.map((c, i) => (
                      <li key={i} className="rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{c.text}</span>
                          <Badge variant="selected" className="border-indigo-200 bg-indigo-50 text-[11px] text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                            {c.type === 'phrase' ? '词组' : c.type === 'pattern' ? '句式' : '论据'}
                          </Badge>
                        </div>
                        {c.why && <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{c.why}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {payload.analysis && payload.analysis !== NO_ANALYSIS && (
                <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">分析</div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {payload.analysis}
                  </div>
                </div>
              )}
              {payload.analysis === NO_ANALYSIS && (
                <p className="text-xs text-gray-400 dark:text-gray-500">本次无需分析</p>
              )}
            </div>
          )}

          {/* ---------- 失败 ---------- */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">没有取到结果</div>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{errorMessage}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setPhase('form')} className="w-full sm:w-auto">返回修改</Button>
                <Button onClick={run} className="w-full gap-1.5 border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg hover:from-brand-red hover:to-brand-deep-red sm:w-auto">
                  <RotateCcw className="h-4 w-4" /> 重试
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        {phase === 'result' && !payload && (
          <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">已选择 {selectedIndices.length} 个单词</span>
              <Button variant="ghost" size="sm" onClick={() => setPhase('form')} className="h-8 px-2 text-xs">再找一次</Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => copyText(selectedWords.map((w) => w.word).join('\n'), 'words')} disabled={selectedWords.length === 0} className="w-full sm:w-auto">
                {copied === 'words' ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制单词列表</>}
              </Button>
              <Button
                onClick={() => copyText(selectedWords.map((w) => `${w.word} | ${w.type} | ${w.meaning}`).join('\n'), 'answer')}
                disabled={selectedWords.length === 0}
                className="w-full border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl sm:w-auto"
              >
                {copied === 'answer' ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制详细列表</>}
              </Button>
            </div>
          </div>
        )}

        {phase === 'result' && payload && payload.verdict === 'ok' && (
          <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setPhase('form')} className="h-8 px-2 text-xs">换个任务</Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => copyText(payload.answer, 'answer')} className="w-full sm:w-auto">
                {copied === 'answer' ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制解答</>}
              </Button>
              <Button
                variant="outline"
                onClick={() => copyText(`${payload.answer}\n\n【分析】\n${payload.analysis}`, 'all')}
                className="w-full sm:w-auto"
              >
                {copied === 'all' ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制全部</>}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || savedId !== null}
                className="w-full gap-1.5 border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl sm:w-auto"
              >
                {savedId !== null ? (<><Check className="h-4 w-4" /> 已存入积累本</>) : saving ? (<><Loader2 className="h-4 w-4 animate-spin" /> 保存中…</>) : (<><BookMarked className="h-4 w-4" /> 存入{notebookId ? '当前积累本' : '积累列表'}</>)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
