/**
 * 作文积累本 E2E 测试共享库
 *
 * - 通过广学账号 SSO 获取真实会话 Cookie（gxwtf_iron_auth）
 * - 用系统 Edge 启动 Playwright
 * - 提供数据库（pg）断言辅助、截图与日志
 *
 * 运行位置：/home/gxwtf/gxwtf_writing（仓库根目录，dotenv 读取 .env）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';
import pg from 'pg';
import { chromium } from 'playwright';

export const BASE = process.env.E2E_BASE || 'https://writing.gxwtf.cn';
/** 所有积累列表页（首页改成每日一句之后，列表入口在这里） */
export const ENTRIES = `${BASE}/books/all`;
export const ACCOUNT = process.env.GXACCOUNT_URL || 'https://account.gxwtf.cn';
export const SYSTEM = new URL(BASE).hostname; // writing.gxwtf.cn
export const COOKIE_NAME = 'gxwtf_iron_auth';
export const BROWSER_PATH = process.env.E2E_BROWSER || '/usr/bin/microsoft-edge';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- credentials

export function creds() {
  if (process.env.GX_IDENT && process.env.GX_PASSWORD) {
    return { identifier: process.env.GX_IDENT, password: process.env.GX_PASSWORD };
  }
  const file = join(HERE, 'creds.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------- SSO login

function makeJar() {
  const jar = new Map(); // "host|name" -> value
  return {
    header(host) {
      const out = [];
      for (const [k, v] of jar) {
        const [h, name] = k.split('|');
        if (host === h || host.endsWith('.' + h)) out.push(`${name}=${v}`);
      }
      return out.join('; ');
    },
    store(res) {
      const host = new URL(res.url).hostname;
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of raw) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i <= 0) continue;
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (value) jar.set(`${host}|${name}`, value);
        else jar.delete(`${host}|${name}`);
      }
    },
    all() {
      return [...jar.entries()].map(([k, v]) => {
        const [host, name] = k.split('|');
        return { host, name, value: v };
      });
    },
  };
}

function httpsify(url) {
  return url.startsWith('http://') ? 'https://' + url.slice(7) : url;
}

export async function loginViaSso({ identifier, password, system = SYSTEM, back = '/' } = {}) {
  const c = creds();
  identifier = identifier || c.identifier;
  password = password || c.password;

  const jar = makeJar();
  const go = async (url, opts = {}) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) e2e',
      Accept: 'text/html,application/json,*/*',
      ...(opts.headers || {}),
    };
    const ck = jar.header(new URL(url).hostname);
    if (ck) headers.Cookie = ck;
    let lastErr;
    for (let a = 1; a <= 4; a++) {
      try {
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
        jar.store(res);
        return res;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1000 * a));
      }
    }
    throw lastErr;
  };

  // 1) 广学账号口令登录（建立 account.gxwtf.cn 会话）
  let r = await go(`${ACCOUNT}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ACCOUNT,
      Referer: `${ACCOUNT}/`,
    },
    body: JSON.stringify({ identifier, password }),
  });
  const txt = await r.text();
  if (r.status !== 200 || !txt.includes('userId')) {
    throw new Error(`广学账号登录失败: HTTP ${r.status} ${txt.slice(0, 200)}`);
  }
  const userId = JSON.parse(txt).userId;

  // 2) 获取 SSO 交接页，从中取回调地址（含一次性 token）
  r = await go(`${ACCOUNT}/sso/login?system=${encodeURIComponent(system)}&back=${encodeURIComponent(back)}`);
  const handoff = await r.text();
  const m = handoff.match(/(https?:\/\/[^"'\s]*\/sso\/callback\?[^"'\s]*)/);
  let callback = m ? m[1] : null;
  if (!callback) {
    const t = handoff.match(/token=([A-Za-z0-9._-]+)/);
    if (t) callback = `https://${system}/sso/callback?back=${encodeURIComponent(back)}&token=${t[1]}`;
  }
  if (!callback) throw new Error('SSO 交接页未找到回调 token');

  // 3) 兑换会话，跟随跳转直至应用落 Cookie
  let url = httpsify(callback);
  for (let i = 0; i < 10; i++) {
    r = await go(url);
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = httpsify(new URL(r.headers.get('location'), url).href);
      continue;
    }
    break;
  }

  const appCookies = jar.all().filter(
    (c2) => c2.host === system && c2.name === COOKIE_NAME
  );
  if (appCookies.length === 0) {
    const names = jar.all().map((c2) => `${c2.host}/${c2.name}`).join(', ');
    throw new Error(`未取得应用会话 Cookie（${COOKIE_NAME}）。现有：${names || '(空)'}`);
  }
  return { userId, cookies: appCookies };
}

// ---------------------------------------------------------------- browser

export async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({
    executablePath: BROWSER_PATH,
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

export async function newContextWithCookies(browser, cookies, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    acceptDownloads: true,
    ...opts,
  });
  await ctx.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.host,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }))
  );
  return ctx;
}

export function attachLogging(page, sink, tag = '') {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      sink.push({ kind: `console.${m.type()}`, text: `[${tag}] ${m.text().slice(0, 500)}` });
    }
  });
  page.on('pageerror', (e) => {
    sink.push({ kind: 'pageerror', text: `[${tag}] ${e.message.slice(0, 500)}` });
  });
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    // 忽略浏览器主动取消（下载/跳转导致）与字体预取失败之外的噪声，统一记录
    sink.push({ kind: 'requestfailed', text: `[${tag}] ${r.url().slice(0, 160)} :: ${err}` });
  });
}

export async function shot(page, name) {
  const path = `/tmp/e2e-writing-${name}.png`;
  try {
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    try {
      await page.screenshot({ path });
      return path;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- database

export async function dbConnect() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error('DATABASE_URL 未设置（请在仓库根目录运行，确保 .env 可被 dotenv 读取）');
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  return client;
}

export async function dbAll(db, sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

export async function dbOne(db, sql, params = []) {
  const rows = await dbAll(db, sql, params);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- UI helpers

/** 等待应用完成鉴权与首屏渲染（已登录或未登录皆可） */
export async function waitAppReady(page, { timeout = 45000 } = {}) {
  // 已登录：任一页面都有导航「登出」；移动端导航会隐藏文字，所以同时认页面特征
  await page.waitForFunction(
    () => {
      const t = document.body?.innerText || '';
      return (
        t.includes('登出') ||
        t.includes('使用广学账号登录') ||
        t.includes('打开我的积累本') ||
        t.includes('我的积累本') ||
        t.includes('所有积累')
      );
    },
    { timeout }
  );
}

/** 等待「所有积累」列表页就绪 */
export async function waitEntriesReady(page, { timeout = 45000 } = {}) {
  await page.waitForFunction(
    () => (document.body?.innerText || '').includes('所有积累'),
    { timeout }
  );
}

/** 读取「共 N 个积累，M 个符合条件」 */
export async function readCounts(page) {
  const txt = await page.locator('body').innerText();
  const m = txt.match(/共\s*(\d+)\s*个积累[，,]\s*(\d+)\s*个符合条件/);
  if (!m) return { total: null, filtered: null };
  return { total: Number(m[1]), filtered: Number(m[2]) };
}

/** 作文卡片（根 div 含 h3 内容标题） */
export function cards(page) {
  return page.locator('div.rounded-lg.border:has(h3)');
}

export function cardByText(page, text) {
  return cards(page).filter({ hasText: text }).first();
}

export async function cardTexts(page) {
  return cards(page).locator('h3').allInnerTexts();
}

/** 打开「添加积累」弹窗 */
export async function openAddModal(page) {
  await page.getByRole('button', { name: /添加积累|^添加$/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/** 关闭任意打开的对话框（Esc） */
export async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {});
}
