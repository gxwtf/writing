import { BookOpen, FileText, PenLine, Sparkles, Tags } from 'lucide-react';
import { GxaccountLogin } from '@/components/GxaccountLogin';

export const UnauthenticatedPage = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-100 dark:from-gray-900 dark:to-gray-800">
      <div className="flex flex-col items-center text-center p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="relative w-32 h-32 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-crimson to-brand-deep-red rounded-full blur-xl opacity-30"></div>
            <BookOpen className="relative w-full h-full text-brand-crimson" />
          </div>
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
            作文积累本
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
            收藏好句好段，沉淀你的写作素材
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 w-full max-w-2xl">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mr-4">
                <PenLine className="w-6 h-6 text-brand-crimson" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                积累与整理
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300">
              记录作文中的好词好句，随时编辑、检索、批量整理
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center mr-4">
                <Tags className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                标签管理
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300">
              按主题、题型、来源自由打标签，快速筛选与回顾
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center mr-4">
                <Sparkles className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                AI 找词
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300">
              AI 从作文中提取高级替换词、高考核心词与外刊词汇
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mr-4">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                PDF 导出
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300">
              一键导出可打印的积累本，方便随身复习
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <GxaccountLogin />
        </div>

        <div className="mt-12 animate-pulse">
          <Sparkles className="w-8 h-8 text-brand-crimson mx-auto" />
        </div>
      </div>
    </div>
  );
};
