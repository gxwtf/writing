'use client';

import { useEffect, useState } from 'react';
import { Sparkles, ArrowUpDown, GraduationCap, Feather, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { WordDifficulty } from '@/actions/writing-entries';

interface AIFindWordsSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (difficulty: WordDifficulty) => void;
}

const difficultyOptions: {
  id: WordDifficulty;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: 'replace',
    title: '常用单词替换词',
    description: '挑出原文里的好词，看它能替换掉哪些你常用的简单词',
    icon: ArrowUpDown,
  },
  {
    id: 'gaokao',
    title: '高考核心词汇',
    description: '高考 3500 词中的高频重点词汇，夯实基础应对考试',
    icon: GraduationCap,
  },
  {
    id: 'writing',
    title: '写作高级表达',
    description: '适合书面表达的高级句型和词汇搭配，提升作文档次',
    icon: Feather,
  },
  {
    id: 'extensive',
    title: '外刊拓展词汇',
    description: '课标外但常出现于外刊的词汇，拓展阅读能力',
    icon: Globe,
  },
];

/**
 * AI 找词难度选择弹窗。
 *
 * 样式注意（2026-10 积累本 UI 改版后统一为赤诚红品牌色）：
 * - 卡片用原生 button 而不是 <Button>：Button 基类带 `whitespace-nowrap`，会把说明文字
 *   压成一行后被截断（旧版就是这个问题）；原生 button 才能让说明文字正常换行。
 * - 选中态不要用 `text-white` 配浅色底（旧版选中后标题直接看不见），改为品牌色描边 + 浅红底 + 深色文字。
 * - 小屏单列、sm 以上两列，避免 390px 下两列把说明挤成两三个字一行。
 */
export const AIFindWordsSelector = ({ isOpen, onClose, onSelect }: AIFindWordsSelectorProps) => {
  const [selectedDifficulty, setSelectedDifficulty] = useState<WordDifficulty | null>(null);

  // 每次打开都回到「未选择」，避免上次的选择残留（残留时会让人误以为已选好）
  useEffect(() => {
    if (isOpen) setSelectedDifficulty(null);
  }, [isOpen]);

  const handleStart = () => {
    if (!selectedDifficulty) return;
    onSelect(selectedDifficulty);
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
              <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">AI 找词</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                选择目标单词难度，AI 将从作文中提取好词
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {difficultyOptions.map((option) => {
              const Icon = option.icon;
              const isSelected = selectedDifficulty === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedDifficulty(option.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-crimson/40 sm:p-4 ${
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
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {option.title}
                    </div>
                    <div className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                      {option.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 dark:border-gray-700 sm:p-6">
          <Button
            onClick={handleStart}
            disabled={!selectedDifficulty}
            className="h-auto w-full rounded-lg bg-gradient-to-r from-brand-crimson to-brand-deep-red py-3 font-semibold text-white shadow-lg transition-all hover:from-brand-red hover:to-brand-deep-red hover:shadow-xl"
          >
            {selectedDifficulty
              ? `开始找词（${difficultyOptions.find((d) => d.id === selectedDifficulty)?.title}）`
              : '请选择目标难度'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
