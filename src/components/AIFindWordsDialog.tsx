'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Check, Sparkles, ClipboardList, Loader2, ArrowUpDown, GraduationCap,
  Feather, Globe, RotateCcw, AlertTriangle, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { AIExtractedWord, WordDifficulty } from '@/actions/writing-entries';

interface AIFindWordsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 选中的作文 id（打开弹窗时传入） */
  entryIds: number[];
}

type Phase = 'choose' | 'running' | 'result' | 'error';

const DIFFICULTIES: {
  id: WordDifficulty;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  { id: 'replace', title: '常用单词替换词', description: '挑出原文里的好词，看它能替换掉哪些你常用的简单词', icon: ArrowUpDown },
  { id: 'gaokao', title: '高考核心词汇', description: '高考 3500 词中的高频重点词汇，夯实基础应对考试', icon: GraduationCap },
  { id: 'writing', title: '写作高级表达', description: '适合书面表达的高级句型和词汇搭配，提升作文档次', icon: Feather },
  { id: 'extensive', title: '外刊拓展词汇', description: '课标外但常出现于外刊的词汇，拓展阅读能力', icon: Globe },
];

/**
 * AI 找词：难度选择 / 生成过程 / 结果，**三个阶段同一个弹窗**。
 *
 * 为什么合并：旧版是两个弹窗——选完难度就关掉，然后 20~30s 里页面上什么都没有，
 * 用户容易以为没反应就走掉了。现在选完难度弹窗原地进入「生成中」，
 * 实时显示思考片段与 JSON 生成过程（SSE 流式，见 /api/ai/find-words），
 * 失败也在弹窗内给出原因和「重试」，不再用 alert。
 */
export const AIFindWordsDialog = ({ isOpen, onClose, entryIds }: AIFindWordsDialogProps) => {
  const [phase, setPhase] = useState<Phase>('choose');
  const [difficulty, setDifficulty] = useState<WordDifficulty | null>(null);
  const [words, setWords] = useState<AIExtractedWord[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [thinking, setThinking] = useState('');
  const [thinkingTotal, setThinkingTotal] = useState(0);
  const [draftJson, setDraftJson] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [meta, setMeta] = useState<{ count?: number; model?: string }>({});
  const [copied, setCopied] = useState(false);
  const [copiedWords, setCopiedWords] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLPreElement | null>(null);
  const startedAtRef = useRef<number>(0);

  // 每次打开回到第一步
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    setPhase('choose');
    setDifficulty(null);
    setWords([]);
    setSelectedIndices([]);
    setErrorMessage('');
    setThinking('');
    setThinkingTotal(0);
    setDraftJson('');
    setElapsedMs(0);
    setMeta({});
    setCopied(false);
    setCopiedWords(false);
    setThinkOpen(true);
  }, [isOpen]);

  // 生成中的计时器
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    return () => clearInterval(timer);
  }, [phase]);

  // 流式文本自动滚到底
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

    let data: { text?: string; words?: AIExtractedWord[]; message?: string; count?: number; model?: string };
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    if (event === 'meta') {
      setMeta({ count: data.count, model: data.model });
    } else if (event === 'thinking') {
      setThinkingTotal((n) => n + (data.text ?? '').length);
      setThinking((prev) => (prev + (data.text ?? '')).slice(-4000));
    } else if (event === 'delta') {
      setDraftJson((prev) => (prev + (data.text ?? '')).slice(-8000));
    } else if (event === 'done') {
      const list = data.words ?? [];
      setWords(list);
      setSelectedIndices(list.map((_, i) => i));
      setPhase('result');
    } else if (event === 'error') {
      setErrorMessage(data.message || 'AI 找词失败，请重试');
      setPhase('error');
    }
  }, []);

  const run = useCallback(
    async (target: WordDifficulty) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setDifficulty(target);
      setPhase('running');
      setWords([]);
      setThinking('');
      setThinkingTotal(0);
      setDraftJson('');
      setErrorMessage('');
      setElapsedMs(0);
      setThinkOpen(true);
      startedAtRef.current = Date.now();

      try {
        const res = await fetch('/api/ai/find-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryIds, difficulty: target }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.json().catch(() => null);
          setErrorMessage((detail as { message?: string } | null)?.message || 'AI 找词服务暂时不可用，请稍后重试');
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
          // 用户主动取消：回到选难度，不报错
          setPhase('choose');
          return;
        }
        console.error('AI 找词失败:', error);
        setErrorMessage('网络中断，请重试');
        setPhase('error');
      } finally {
        abortRef.current = null;
      }
    },
    [entryIds, handleEvent]
  );

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('choose');
  };

  const toggleSelectAll = () => {
    setSelectedIndices((prev) => (prev.length === words.length ? [] : words.map((_, i) => i)));
  };
  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const selectedWords = words.filter((_, i) => selectedIndices.includes(i));

  const copyDetail = async () => {
    await navigator.clipboard.writeText(
      selectedWords.map((w) => `${w.word} | ${w.type} | ${w.meaning}`).join('\n')
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyWords = async () => {
    await navigator.clipboard.writeText(selectedWords.map((w) => w.word).join('\n'));
    setCopiedWords(true);
    setTimeout(() => setCopiedWords(false), 2000);
  };

  const subtitle = (() => {
    if (phase === 'running') {
      const stage = !meta.model ? '读取语料' : draftJson ? '校验整理' : '生成词条';
      return `${meta.count ? `正在分析 ${meta.count} 篇作文` : '正在分析作文'} · ${stage} · 已用 ${(elapsedMs / 1000).toFixed(1)}s`;
    }
    if (phase === 'result') return `共找到 ${words.length} 个好词，已选择 ${selectedIndices.length} 个`;
    if (phase === 'error') return '本次没有取到结果';
    return '选择目标单词难度，AI 将从作文中提取好词';
  })();

  // 三步进度：读到语料(meta) → 生成词条(thinking/无 JSON 时) → 校验去重(开始出 JSON 后)
  const stepIndex = phase === 'result' ? 3 : !meta.model ? 1 : draftJson ? 3 : 2;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        {/* 统一 Header：三个阶段同一个「AI 找词」 */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-purple-50/70 p-5 dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">AI 找词</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600 tabular-nums dark:text-gray-400">
                {subtitle}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭" className="h-9 w-9 shrink-0 p-2">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto p-4 sm:p-6">
          {/* ---------- 第一步：选难度 ---------- */}
          {phase === 'choose' && (
            <div className="space-y-4">
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
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white hover:shadow-sm dark:border-gray-600 dark:bg-gray-700'
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-10 sm:w-10 ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'border border-gray-200 bg-white text-purple-600 dark:border-gray-500 dark:bg-gray-800'
                        }`}
                      >
                        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{option.title}</div>
                        <div className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                          {option.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <Button
                onClick={() => difficulty && run(difficulty)}
                disabled={!difficulty}
                className="h-auto w-full rounded-lg bg-gradient-to-r from-brand-crimson to-brand-deep-red py-3 font-semibold text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl"
              >
                {difficulty
                  ? `开始找词（${DIFFICULTIES.find((d) => d.id === difficulty)?.title}）`
                  : '请选择目标难度'}
              </Button>
            </div>
          )}

          {/* ---------- 第二步：生成中（有过程反馈，不是干等） ---------- */}
          {phase === 'running' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-gray-600 dark:bg-gray-700/60">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-purple-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    AI 正在提取「{DIFFICULTIES.find((d) => d.id === difficulty)?.title}」…
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                    {elapsedMs > 45_000
                      ? '本次模型思考较久（已超过 45 秒），可以继续等，或点「停止」换个难度重试'
                      : '通常需要 10~30 秒；可以先看下面的思考与生成过程'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancel}
                  className="shrink-0 gap-1.5"
                  title="停止本次分析"
                >
                  <Square className="h-3.5 w-3.5" /> 停止
                </Button>
              </div>

              {/* 不确定进度条：让「有在动」这件事一眼可见 */}
              <div className="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-label="生成中">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-crimson" />
              </div>

              {/* 三步进度 */}
              <ol className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {[
                  { short: '语料', long: '读取作文语料' },
                  { short: '生成', long: '生成词条 JSON' },
                  { short: '校验', long: '校验与去重' },
                ].map(({ short, long: label }, i) => {
                  const done = i < stepIndex - 1;
                  const active = i === stepIndex - 1;
                  return (
                    <li key={label} className="flex flex-1 items-center gap-2">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                          done
                            ? 'bg-brand-crimson text-white'
                            : active
                              ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className={`whitespace-nowrap ${active ? 'font-medium text-gray-700 dark:text-gray-200' : ''}`}>
                        <span className="sm:hidden">{short}</span>
                        <span className="hidden sm:inline">{label}</span>
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
                  <span>生成的 JSON</span>
                  <span className="tabular-nums">{draftJson.length} 字</span>
                </div>
                <pre
                  ref={streamBoxRef}
                  className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                >
                  {draftJson ||
                    (thinking
                      ? '模型正在思考（见上方「AI 思考过程」），思考结束后会一次性输出词条 JSON…'
                      : `模型正在分析作文，等待首个 token…（已等 ${(elapsedMs / 1000).toFixed(0)}s）`)}
                </pre>
              </div>
            </div>
          )}

          {/* ---------- 第三步：结果 ---------- */}
          {phase === 'result' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  <Checkbox checked={selectedIndices.length === words.length} onCheckedChange={toggleSelectAll} />
                  <span className="whitespace-nowrap">
                    {selectedIndices.length === words.length ? '取消全选' : '全选'}
                  </span>
                </button>
                <span className="whitespace-nowrap text-sm text-gray-500 tabular-nums dark:text-gray-400">
                  {selectedIndices.length} / {words.length}
                </span>
              </div>

              <div className="space-y-3">
                {words.map((word, index) => (
                  <div
                    key={`${word.word}-${index}`}
                    className={`rounded-xl border p-4 transition-colors ${
                      selectedIndices.includes(index)
                        ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-900/20'
                        : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedIndices.includes(index)}
                        onCheckedChange={() => toggleSelect(index)}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-base font-bold break-words text-gray-900 dark:text-white sm:text-lg">
                            {word.word}
                          </span>
                          <Badge
                            variant="selected"
                            className="border-gray-300 bg-gray-100 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                          >
                            {word.type}
                          </Badge>
                          {word.replaceWord && (
                            <Badge
                              variant="selected"
                              className="border-blue-200 bg-blue-50 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                            >
                              代替 {word.replaceWord}
                            </Badge>
                          )}
                          {word.difficultyTag && (
                            <Badge
                              variant="selected"
                              className="border-amber-200 bg-amber-50 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            >
                              {word.difficultyTag}
                            </Badge>
                          )}
                          {word.sourceDomain && (
                            <Badge
                              variant="selected"
                              className="border-indigo-200 bg-indigo-50 text-xs text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
                            >
                              {word.sourceDomain}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed break-words text-gray-700 dark:text-gray-200">
                          {word.meaning}
                        </p>
                        {word.sentence && (
                          <p className="mt-2 text-sm leading-relaxed break-words text-gray-600 italic dark:text-gray-400">
                            例句: {word.sentence}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------- 失败：在弹窗内说清原因 ---------- */}
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
                <Button variant="outline" onClick={() => setPhase('choose')} className="w-full sm:w-auto">
                  换个难度
                </Button>
                <Button
                  onClick={() => difficulty && run(difficulty)}
                  className="w-full gap-1.5 border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg hover:from-brand-red hover:to-brand-deep-red sm:w-auto"
                >
                  <RotateCcw className="h-4 w-4" /> 重试
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ---------- 底部操作区（结果阶段）---------- */}
        {phase === 'result' && (
          <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                已选择 {selectedIndices.length} 个单词
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPhase('choose')} className="h-8 px-2 text-xs">
                再找一次
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={copyWords}
                disabled={selectedWords.length === 0}
                className="w-full sm:w-auto"
              >
                {copiedWords ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制单词列表</>}
              </Button>
              <Button
                onClick={copyDetail}
                disabled={selectedWords.length === 0}
                className="w-full border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl sm:w-auto"
              >
                {copied ? <><Check className="h-4 w-4" /> 已复制</> : <><ClipboardList className="h-4 w-4" /> 复制详细列表</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
