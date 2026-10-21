'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Layers,
  Loader2,
  Plus,
  Quote,
  Sparkles,
  Tags,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { UnauthenticatedPage } from '@/components/UnauthenticatedPage';
import { Navbar } from '@/components/Navbar';
import { loadHomeStats, loadNotebooks, type HomeStats } from '@/actions/notebooks';
import { getDailyQuote, type DailyQuote } from '@/constants/quotes';
import type { Notebook } from '@/types/word';

// 积累本卡片配色（照抄广学英语首页单词本列表的四色轮换）
const BOOK_COLORS = [
  { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-brand-crimson dark:text-red-400' },
  { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  { bg: 'bg-violet-50 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
];

function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatDate(date: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${weekdays[date.getDay()]}`;
}

/**
 * 首页。
 *
 * 版式照抄广学英语首页（问候 + 主卡片 + 统计条 + 积累本列表），
 * 因为本项目没有出题 / 复习功能，主卡片中央换成「每日一句」励志文案，
 * 主按钮改为「打开我的积累本」。
 */
export function HomePageContent() {
  const { isLoggedIn, isClient, isLoading, userInfo } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  // 日期/文案在挂载后再算，避免服务端与浏览器时区不同导致水合不一致
  const [today, setToday] = useState<Date | null>(null);
  const [quote, setQuote] = useState<DailyQuote | null>(null);

  useEffect(() => {
    const now = new Date();
    setToday(now);
    setQuote(getDailyQuote(now));
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [statsData, booksData] = await Promise.all([loadHomeStats(), loadNotebooks()]);
      setStats(statsData);
      setNotebooks(booksData);
    } catch (error) {
      console.error('加载首页数据失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isClient || !isLoggedIn) return;
    loadData();
  }, [isClient, isLoggedIn, loadData]);

  if (!isClient || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <UnauthenticatedPage />;
  }

  const statItems = [
    {
      label: '积累本',
      value: stats?.notebooks ?? 0,
      icon: Layers,
      color: 'text-brand-crimson dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-900/30',
    },
    {
      label: '积累条目',
      value: stats?.entries ?? 0,
      icon: BookOpen,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-900/30',
    },
    {
      label: '标签',
      value: stats?.tags ?? 0,
      icon: Tags,
      color: 'text-violet-600 dark:text-violet-400',
      bg: 'bg-violet-50 dark:bg-violet-900/30',
    },
    {
      label: '今日新增',
      value: stats?.todayEntries ?? 0,
      icon: CalendarClock,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    },
  ];

  const hasEntries = !loading && (stats?.entries ?? 0) > 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar currentPage="home" />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* 问候 */}
        <div className="text-center mb-8">
          <p className="text-xs sm:text-sm text-gray-400 dark:text-gray-500 tracking-wide">
            {today ? formatDate(today) : '\u00a0'}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            {today ? getGreeting(today) : '你好'}，{userInfo?.userName || '同学'}
          </h1>
        </div>

        {/* 主卡片：每日一句 + 打开积累本 */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-red-100 dark:border-gray-700 shadow-sm p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 dark:bg-red-900/30">
              <Quote className="h-5 w-5 text-brand-crimson dark:text-red-400" />
            </div>

            {quote ? (
              <>
                <p className="mt-5 text-base sm:text-lg font-medium leading-relaxed text-gray-900 dark:text-white">
                  “{quote.en}”
                </p>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {quote.zh}
                </p>
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  —— {quote.source}
                </p>
              </>
            ) : (
              <div className="mt-5 h-16" aria-hidden />
            )}

            <button
              onClick={() => router.push('/books')}
              className="mt-6 w-full sm:w-auto sm:min-w-[220px] flex items-center justify-center gap-2 px-6 py-3 bg-brand-crimson hover:bg-brand-deep-red text-white rounded-2xl font-semibold text-base shadow-lg shadow-red-500/20 transition-all"
            >
              打开我的积累本
              <ArrowRight className="h-5 w-5" />
            </button>

            {!loading && !hasEntries && (
              <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">
                还没有积累内容，去积累本里添加第一条吧
              </p>
            )}
          </div>

          {/* 统计条 */}
          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 grid grid-cols-4 gap-2">
            {statItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex flex-col items-center text-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.bg}`}>
                    <Icon className={`h-4 w-4 ${item.color}`} />
                  </div>
                  <div className={`mt-2 text-lg sm:text-xl font-bold ${item.color}`}>
                    {loading ? '-' : item.value}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    {item.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 我的积累本 */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">我的积累本</h2>
            <Link
              href="/books"
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1 transition-colors"
            >
              查看全部
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400 dark:text-gray-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              加载中...
            </div>
          ) : notebooks.length === 0 ? (
            <Link
              href="/books"
              className="flex items-center justify-center gap-2 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-6 text-sm text-gray-400 dark:text-gray-500 hover:border-brand-crimson/40 transition-colors"
            >
              <Plus className="h-4 w-4" />
              还没有积累本，去创建一个
            </Link>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
              {notebooks.slice(0, 4).map((book, index) => {
                const color = BOOK_COLORS[index % BOOK_COLORS.length];
                return (
                  <Link
                    key={book.id}
                    href={`/books/${book.id}`}
                    className="group flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color.bg}`}
                    >
                      <BookOpen className={`h-4 w-4 ${color.text}`} />
                    </div>
                    <span className="flex-1 min-w-0 font-medium text-gray-900 dark:text-white truncate">
                      {book.name}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {book.entryCount} 条
                    </span>
                    <ArrowRight className="h-4 w-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-300 transition-colors shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-1">
          <Sparkles className="h-3.5 w-3.5" />
          每天读一句，攒进你的素材本
        </p>
      </div>
    </div>
  );
}
