'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Check,
  Loader2,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AIExtractedWord } from '@/actions/writing-entries';

interface AIFindWordsModalProps {
  isOpen: boolean;
  onClose: () => void;
  words: AIExtractedWord[];
  isLoading: boolean;
}

/**
 * AI 找词结果弹窗。
 *
 * 作文积累本独立后不再直接写入广学英语单词本，这里只负责展示与复制，
 * 用户可把结果粘贴到广学英语的「批量添加单词」中使用。
 *
 * 样式注意（2026-10 积累本 UI 改版后统一为赤诚红品牌色）：
 * - 徽标必须用 `variant="selected"`（无内置样式）+ 显式配色：`secondary` 变体的
 *   `bg-secondary` 会在 CSS 里盖掉 className 里的 bg-*，导致「代替 X」「高考高频」
 *   「领域」三种徽标渲染成同一个浅粉色，读者分不清。
 * - 底部栏在小屏改为纵向排列：旧版横排时「已选择 N 个单词」被挤成一列竖字。
 * - 正文区限制高度并自行滚动，避免长词表把弹窗撑出屏幕。
 */
export const AIFindWordsModal = ({
  isOpen,
  onClose,
  words,
  isLoading,
}: AIFindWordsModalProps) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedWords, setCopiedWords] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndices(words.map((_, i) => i));
      setCopied(false);
      setCopiedWords(false);
    }
  }, [isOpen, words]);

  const toggleSelectAll = () => {
    if (selectedIndices.length === words.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(words.map((_, i) => i));
    }
  };

  const toggleSelect = (index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const selectedWords = words.filter((_, i) => selectedIndices.includes(i));

  const handleCopyDetail = async () => {
    const text = selectedWords
      .map((word) => `${word.word} | ${word.type} | ${word.meaning}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyWords = async () => {
    const text = selectedWords.map((word) => word.word).join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedWords(true);
    setTimeout(() => setCopiedWords(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-purple-50/70 p-5 dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
                AI 找词结果
              </h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {isLoading
                  ? '正在分析作文...'
                  : `共找到 ${words.length} 个好词，已选择 ${selectedIndices.length} 个`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="关闭"
            className="h-9 w-9 shrink-0 p-2"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* 正文用原生滚动容器 + 明确的 max-height：ScrollArea 的 viewport 在 flex 容器里
            量不到可用高度（clientHeight 会被内容撑开），会把卡片顶到页脚外面去 */}
        <div className="max-h-[calc(100dvh-15rem)] overflow-y-auto p-4 sm:p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-purple-600" />
              <p className="text-gray-600 dark:text-gray-400">AI 正在分析作文内容...</p>
            </div>
          ) : words.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-600 dark:text-gray-400">未找到合适的单词</p>
            </div>
          ) : (
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
                <span className="whitespace-nowrap text-sm tabular-nums text-gray-500 dark:text-gray-400">
                  {selectedIndices.length} / {words.length}
                </span>
              </div>

              <div className="space-y-3">
                  {words.map((word, index) => (
                    <div
                      key={index}
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
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
            已选择 {selectedIndices.length} 个单词
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={handleCopyWords}
              disabled={selectedWords.length === 0}
              className="w-full sm:w-auto"
            >
              {copiedWords ? (
                <><Check className="h-4 w-4" /> 已复制</>
              ) : (
                <><ClipboardList className="h-4 w-4" /> 复制单词列表</>
              )}
            </Button>
            <Button
              onClick={handleCopyDetail}
              disabled={selectedWords.length === 0}
              className="w-full border-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl sm:w-auto"
            >
              {copied ? (
                <><Check className="h-4 w-4" /> 已复制</>
              ) : (
                <><ClipboardList className="h-4 w-4" /> 复制详细列表</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
