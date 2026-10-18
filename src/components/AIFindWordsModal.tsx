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
import { ScrollArea } from '@/components/ui/scroll-area';
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
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <div className="flex items-center justify-between p-6 bg-gradient-to-r from-purple-50 to-violet-50 dark:from-gray-700 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                AI 找词结果
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {isLoading
                  ? '正在分析作文...'
                  : `共找到 ${words.length} 个好词，已选择 ${selectedIndices.length} 个`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="p-2 h-9 w-9 shrink-0">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="overflow-auto p-6 space-y-4 max-h-[calc(90vh-200px)]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500 mb-4" />
              <p className="text-gray-600 dark:text-gray-400">AI 正在分析作文内容...</p>
            </div>
          ) : words.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600 dark:text-gray-400">未找到合适的单词</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  <Checkbox checked={selectedIndices.length === words.length} onCheckedChange={toggleSelectAll} />
                  <span>{selectedIndices.length === words.length ? '取消全选' : '全选'}</span>
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedIndices.length} / {words.length}
                </span>
              </div>

              <ScrollArea className="h-80">
                <div className="space-y-3 pr-2">
                  {words.map((word, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-xl border ${
                        selectedIndices.includes(index)
                          ? 'border-purple-300 bg-purple-50/50 dark:border-purple-700 dark:bg-purple-900/20'
                          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selectedIndices.includes(index)}
                          onCheckedChange={() => toggleSelect(index)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-lg text-gray-900 dark:text-white">
                              {word.word}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {word.type}
                            </Badge>
                            {word.replaceWord && (
                              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                替换: {word.replaceWord}
                              </Badge>
                            )}
                            {word.difficultyTag && (
                              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                                {word.difficultyTag}
                              </Badge>
                            )}
                            {word.sourceDomain && (
                              <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
                                {word.sourceDomain}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 break-words">
                            {word.meaning}
                          </p>
                          {word.sentence && (
                            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2 italic break-words">
                              例句: {word.sentence}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            已选择 {selectedIndices.length} 个单词
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCopyWords}
              disabled={selectedWords.length === 0}
              className="flex items-center gap-2"
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
              className="flex items-center gap-2 bg-purple-500 hover:bg-purple-600"
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
