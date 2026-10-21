'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { UnauthenticatedPage } from '@/components/UnauthenticatedPage';
import { Navbar } from '@/components/Navbar';
import { WritingPageContent } from '@/components/WritingPageContent';
import { getNotebook } from '@/actions/notebooks';
import type { Notebook } from '@/types/word';

/**
 * 积累本详情页外壳。
 * 照抄广学英语 WordbookDetailPageContent：`/books/all` 显示全部积累，`/books/<id>` 显示本内积累。
 */
export function NotebookDetailPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isAll = id === 'all';
  const notebookId = Number(id);
  const { isLoggedIn, isClient, isLoading } = useAuth();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isClient || !isLoggedIn) return;
    if (isAll) {
      setLoading(false);
      return;
    }
    if (!Number.isFinite(notebookId)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getNotebook(notebookId)
      .then((data) => {
        if (!cancelled) setNotebook(data);
      })
      .catch((error) => console.error('加载积累本失败:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isClient, isLoggedIn, notebookId, isAll]);

  if (!isClient || isLoading || (isLoggedIn && loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <UnauthenticatedPage />;
  }

  if (isAll) {
    return <WritingPageContent />;
  }

  if (!notebook) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar currentPage="books" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <BookOpen className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-4">积累本不存在或无权访问</p>
          <Link
            href="/books"
            className="inline-flex items-center gap-1 text-brand-crimson hover:text-brand-deep-red dark:text-red-400 dark:hover:text-red-300"
          >
            <ArrowLeft className="h-4 w-4" />
            返回我的积累本
          </Link>
        </div>
      </div>
    );
  }

  return <WritingPageContent notebookId={notebookId} notebookName={notebook.name} />;
}
