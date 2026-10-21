'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Notebook } from '@/types/word';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface NotebookTransferDialogProps {
  isOpen: boolean;
  mode: 'copy' | 'move';
  notebooks: Notebook[];
  excludeNotebookId?: number;
  selectedCount: number;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (targetNotebookIds: number[]) => void;
}

/**
 * 「复制 / 移动到其它积累本」弹窗。
 * 结构照抄广学英语的 WordbookTransferDialog，只是单词换成积累条目（条）。
 */
export function NotebookTransferDialog({
  isOpen,
  mode,
  notebooks,
  excludeNotebookId,
  selectedCount,
  submitting,
  error,
  onClose,
  onConfirm,
}: NotebookTransferDialogProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const availableBooks = useMemo(
    () => notebooks.filter((book) => book.id !== excludeNotebookId),
    [notebooks, excludeNotebookId]
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
    }
  }, [isOpen, mode]);

  const toggleBook = (bookId: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? Array.from(new Set([...prev, bookId])) : prev.filter((id) => id !== bookId)
    );
  };

  const title = mode === 'copy' ? '复制到其它积累本' : '移动到其它积累本';
  const confirmLabel = mode === 'copy' ? '复制' : '移动';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            将选中的 {selectedCount} 条积累{mode === 'copy' ? '复制' : '移动'}到目标积累本。
            {mode === 'move' ? '移动后这些积累会从当前积累本移除。' : '原积累本中的积累会保留。'}
            已存在于目标积累本中的积累会自动去重，不会重复添加。
          </DialogDescription>
        </DialogHeader>

        {availableBooks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            没有其它积累本可选，请先创建新的积累本。
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                已选 {selectedIds.length} / {availableBooks.length}
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedIds(availableBooks.map((b) => b.id))}
                  className="text-xs text-brand-crimson dark:text-red-400 hover:underline"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
                >
                  全不选
                </button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
              {availableBooks.map((book) => (
                <label
                  key={book.id}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.includes(book.id)}
                    onCheckedChange={(checked) => toggleBook(book.id, checked === true)}
                  />
                  <span className="truncate flex-1">{book.name}</span>
                  <span className="text-xs text-gray-400">{book.entryCount}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(selectedIds)}
            disabled={submitting || availableBooks.length === 0 || selectedIds.length === 0}
          >
            {submitting ? `${confirmLabel}中...` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
