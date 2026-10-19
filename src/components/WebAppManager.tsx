'use client';

/**
 * 添加到主屏幕（PWA / A2HS）引导 + Service Worker 注册。
 *
 * - 生产环境注册 /sw.js（只缓存静态资源，见 public/sw.js 注释）
 * - iOS Safari：底部弹出「添加到主屏幕」操作提示（可关闭，关闭后不再提示）
 * - Android / 鸿蒙等 Chromium 内核移动浏览器：捕获 beforeinstallprompt，
 *   点「安装」直接拉起系统安装弹窗
 * - 已在独立窗口（standalone）运行时不做任何提示
 */

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

const DISMISS_KEY = 'gxwtf-writing-a2hs-dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua);
}

/** 仅移动端展示安装引导，避免桌面端回归测试被浮层干扰 */
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function WebAppManager() {
  const [hint, setHint] = useState<'ios' | 'install' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // 注册 Service Worker（仅生产环境，避免开发环境缓存 HMR 资源）
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker 注册失败:', err);
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  const dismissed = useCallback(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  }, []);

  // iOS Safari（非 standalone）引导「添加到主屏幕」
  useEffect(() => {
    if (isStandalone() || !isIos() || !isSafari() || dismissed()) return;
    setHint('ios');
  }, [dismissed]);

  // Chromium 移动端：接管安装事件，改为站内按钮触发
  useEffect(() => {
    if (isStandalone() || isIos() || !isMobile() || dismissed()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setHint('install');
    };
    const onInstalled = () => {
      setHint(null);
      setDeferredPrompt(null);
      try {
        localStorage.setItem(DISMISS_KEY, 'true');
      } catch {
        // 忽略写入失败
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [dismissed]);

  const dismiss = () => {
    setHint(null);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // 忽略写入失败
    }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setHint(null);
    setDeferredPrompt(null);
  };

  if (!hint) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] pointer-events-none"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)',
        paddingLeft: 'calc(env(safe-area-inset-left) + 0.75rem)',
        paddingRight: 'calc(env(safe-area-inset-right) + 0.75rem)',
      }}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-start gap-3 rounded-xl bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur">
        {hint === 'ios' ? (
          <Share className="mt-0.5 h-5 w-5 shrink-0 text-white" />
        ) : (
          <Download className="mt-0.5 h-5 w-5 shrink-0 text-white" />
        )}
        <div className="min-w-0 flex-1 text-sm leading-relaxed">
          <p className="font-semibold">安装「作文积累本」到主屏幕</p>
          {hint === 'ios' ? (
            <p className="mt-0.5 text-white/80">
              点击底部
              <Share className="mx-1 inline h-4 w-4 align-text-bottom" />
              分享按钮，选择「添加到主屏幕」，即可全屏使用。
            </p>
          ) : (
            <p className="mt-0.5 text-white/80">安装后可全屏使用，像 App 一样从桌面直接打开。</p>
          )}
        </div>
        {hint === 'install' && (
          <button
            onClick={install}
            className="shrink-0 self-center rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-white/90"
          >
            安装
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="不再提示"
          className="-mr-1 rounded-md p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
