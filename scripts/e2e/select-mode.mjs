// E2E regression for 积累本「选择」模式 + 标题栏「切换积累本」下拉
//
// 需求（与广学英语单词本同步）：
//  1. 积累本详情页默认**不显示**勾选框（不能勾选），点「选择」后才进入选择模式
//  2. 积累本名字后面有 ⌄，点开可以切换积累本
//
// Covers:
//  1. 默认：卡片无勾选框；点卡片不选中；批量操作禁用
//  2. 点「选择」：每张卡片出现勾选框；勾选框 / 卡片本体都能选中；全选 / 取消全选
//  3. 点「退出」：勾选框消失、已选清空
//  4. 标题栏 ⌄：列出全部积累本，点其它积累本跳转并换标题换内容
//  5. 手机宽度 390px：同上（图标按钮 + aria-label）
//
// Usage（仓库根目录）：
//   node scripts/e2e/select-mode.mjs                      # 默认测本地 http://localhost:3014
//   E2E_BASE=https://writing.gxwtf.cn node scripts/e2e/select-mode.mjs
//
// 说明：测试账号（scripts/e2e/creds.json）默认没有积累本/积累，本脚本会先建两个临时积累本
//       （3 条 + 1 条积累）供断言使用，**跑完 finally 里全部删除**（只删本次新建的 id）。
import { chromium } from 'playwright';
import pg from 'pg';
import dotenv from 'dotenv';
import { creds, loginViaSso } from './lib.mjs';

dotenv.config({ path: '.env' });

const BASE = process.env.E2E_BASE || 'http://localhost:3014';
const EXEC = process.env.BROWSER_PATH || '/usr/bin/microsoft-edge';
const SHOTS = process.env.SHOT_DIR || '/tmp';

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

const CHECKBOX = '[data-slot="checkbox"]';
const BATCH_BUTTON = '[data-batch-button]:visible';

const countCheckboxes = (page) => page.locator(CHECKBOX).count();
const cardCount = (page) => page.locator('h3').count();

async function selectedCount(page) {
  const btn = page.locator(BATCH_BUTTON).first();
  const disabled = await btn.isDisabled().catch(() => true);
  if (disabled) return 0;
  const text = (await btn.innerText()).replace(/\s+/g, '');
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

async function openNotebook(page, id) {
  await page.goto(`${BASE}/books/${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('h3').first().waitFor({ timeout: 25000 });
  await page.waitForTimeout(500);
}

async function runDesktop(browser, cookies, ids) {
  console.log('\n=== 桌面端 1440px ===');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));

  await openNotebook(page, ids.bookA);
  const n = await cardCount(page);
  console.log(`[e2e] 积累本 A=${ids.bookA}，本页 ${n} 条`);
  check(n === 3, '积累本 A 有 3 条积累', `n=${n}`);

  // 1) 默认：无勾选框，点卡片不选中
  check((await countCheckboxes(page)) === 0, '默认不显示勾选框', `checkboxes=${await countCheckboxes(page)}`);
  await page.locator('h3').first().click();
  await page.waitForTimeout(300);
  check((await countCheckboxes(page)) === 0, '默认点卡片不出现勾选框');
  check((await selectedCount(page)) === 0, '默认点卡片不会选中（批量操作仍禁用）');
  await page.screenshot({ path: `${SHOTS}/writing-select-default.png`, fullPage: false });

  // 2) 选择模式
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.waitForTimeout(400);
  check((await countCheckboxes(page)) === n, '点「选择」后每条都出现勾选框', `checkboxes=${await countCheckboxes(page)}`);
  check(await page.getByRole('button', { name: '全选', exact: true }).isVisible(), '选择模式下出现「全选」按钮');
  await page.screenshot({ path: `${SHOTS}/writing-select-mode.png`, fullPage: false });

  await page.locator(CHECKBOX).first().click();
  await page.waitForTimeout(250);
  check((await selectedCount(page)) === 1, '点勾选框选中 1 条', `selected=${await selectedCount(page)}`);
  await page.locator('h3').nth(1).click();
  await page.waitForTimeout(250);
  check((await selectedCount(page)) === 2, '选择模式下点卡片本体也能选中', `selected=${await selectedCount(page)}`);

  await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.waitForTimeout(250);
  check((await selectedCount(page)) === n, '「全选」选中全部', `selected=${await selectedCount(page)}`);
  await page.getByRole('button', { name: '取消全选', exact: true }).click();
  await page.waitForTimeout(250);
  check((await selectedCount(page)) === 0, '再点一次即取消全选');

  // 3) 退出选择模式
  await page.locator(CHECKBOX).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.waitForTimeout(400);
  check((await countCheckboxes(page)) === 0, '退出后勾选框消失');
  check((await selectedCount(page)) === 0, '退出后已选清空（批量操作禁用）');

  // 4) 标题栏「切换积累本」下拉
  const switcher = page.getByRole('button', { name: '切换积累本' });
  check(await switcher.isVisible(), '积累本名后出现「切换积累本」下拉箭头');
  await switcher.click();
  await page.waitForTimeout(400);
  const items = page.getByRole('menuitem');
  check((await items.count()) >= 2, '下拉里列出全部积累本', `items=${await items.count()}`);
  await page.screenshot({ path: `${SHOTS}/writing-notebook-switcher.png`, fullPage: false });
  await items.filter({ hasText: ids.bookBName }).first().click();
  await page.waitForURL(new RegExp(`/books/${ids.bookB}(\\?|$)`), { timeout: 20000 });
  await page.locator('h3').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const title = (await page.locator('h1').first().innerText()).trim();
  check(title === ids.bookBName, '切换后标题变成目标积累本', `title=${title}`);
  check((await cardCount(page)) === 1, '切换后内容是目标积累本的（1 条）', `n=${await cardCount(page)}`);

  await ctx.close();
}

async function runMobile(browser, cookies, ids) {
  console.log('\n=== 手机端 390px ===');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'zh-CN',
  });
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));

  await openNotebook(page, ids.bookA);
  check((await countCheckboxes(page)) === 0, '手机端默认不显示勾选框');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.waitForTimeout(400);
  check((await countCheckboxes(page)) === 3, '手机端点「选择」后出现勾选框', `checkboxes=${await countCheckboxes(page)}`);
  await page.screenshot({ path: `${SHOTS}/writing-select-mobile-mode.png`, fullPage: false });
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.waitForTimeout(250);
  check((await selectedCount(page)) === 3, '手机端「全选」可用', `selected=${await selectedCount(page)}`);
  await page.getByRole('button', { name: /退出选择/ }).click();
  await page.waitForTimeout(400);
  check((await countCheckboxes(page)) === 0, '手机端退出后勾选框消失');
  check((await selectedCount(page)) === 0, '手机端退出后已选清空');
  await ctx.close();
}

// ---------------------------------------------------------------- 造/清临时数据
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const created = { notebooks: [], entries: [] };

async function seed(userId) {
  const stamp = Date.now().toString(36);
  const bookA = `E2E选择模式-A-${stamp}`;
  const bookB = `E2E选择模式-B-${stamp}`;
  for (const name of [bookA, bookB]) {
    const r = await pool.query(
      `INSERT INTO "Notebook" ("userId", name, "updatedAt") VALUES ($1, $2, now()) RETURNING id`,
      [userId, name],
    );
    created.notebooks.push(r.rows[0].id);
  }
  const [idA, idB] = created.notebooks;
  const entries = [
    { content: 'E2E 积累 1：坚持就是胜利。', notebook: idA },
    { content: 'E2E 积累 2：细节决定成败。', notebook: idA },
    { content: 'E2E 积累 3：行百里者半九十。', notebook: idA },
    { content: 'E2E 积累 4（B 本）：读书破万卷。', notebook: idB },
  ];
  for (const e of entries) {
    const r = await pool.query(
      `INSERT INTO "WritingEntry" ("userId", content, subject, "updatedAt") VALUES ($1, $2, 'english', now()) RETURNING id`,
      [userId, e.content],
    );
    const entryId = r.rows[0].id;
    created.entries.push(entryId);
    await pool.query(
      `INSERT INTO "NotebookEntry" ("notebookId", "writingEntryId") VALUES ($1, $2)`,
      [e.notebook, entryId],
    );
  }
  return { bookA: idA, bookB: idB, bookBName: bookB, bookAName: bookA };
}

async function cleanup() {
  try {
    for (const id of created.notebooks) {
      await pool.query(`DELETE FROM "NotebookEntry" WHERE "notebookId" = $1`, [id]);
      await pool.query(`DELETE FROM "Notebook" WHERE id = $1 AND name LIKE 'E2E选择模式-%'`, [id]);
    }
    for (const id of created.entries) {
      await pool.query(`DELETE FROM "NotebookEntry" WHERE "writingEntryId" = $1`, [id]);
      await pool.query(`DELETE FROM "WritingEntryTag" WHERE "writingEntryId" = $1`, [id]);
      await pool.query(`DELETE FROM "WritingEntry" WHERE id = $1 AND content LIKE 'E2E 积累%'`, [id]);
    }
    console.log(
      `\n[e2e] 清理完成：删掉临时积累本 ${created.notebooks.length} 个、临时积累 ${created.entries.length} 条`,
    );
  } catch (e) {
    console.log('[e2e] 清理失败（请手动删除 E2E选择模式-* / E2E 积累*）：', e.message.slice(0, 200));
  }
}

// ---------------------------------------------------------------- 登录
const { identifier, password } = creds();
let userId;
let cookies;
try {
  const login = await loginViaSso({ identifier, password, system: 'writing.gxwtf.cn' });
  userId = login.userId;
  cookies = login.cookies;
  console.log(`[e2e] user=${identifier} userId=${userId}（SSO 登录）`);
} catch (error) {
  console.log(`[e2e] SSO 登录失败（${error.message.slice(0, 80)}），改用本地签名会话`);
  const row = await pool.query(
    `SELECT "userId","userName",admin,email,"realName" FROM "User" WHERE "userName"=$1 LIMIT 1`,
    [identifier],
  );
  const user = row.rows[0];
  if (!user) throw new Error(`本地也没有用户 ${identifier}`);
  userId = user.userId;
  const secret = process.env.SECRET_COOKIE_PASSWORD;
  if (!secret) throw new Error('缺少 SECRET_COOKIE_PASSWORD，无法签名会话');
  const { sealData } = await import('iron-session');
  const sealed = await sealData(
    {
      isLoggedIn: true,
      userId: user.userId,
      userName: user.userName,
      admin: user.admin,
      email: user.email ?? undefined,
      realName: user.realName ?? undefined,
    },
    { password: secret, ttl: 7 * 24 * 60 * 60 },
  );
  cookies = [{ name: 'gxwtf_iron_auth', value: sealed, host: new URL(BASE).hostname }];
  console.log(`[e2e] user=${identifier} userId=${userId}（本地签名会话）`);
}

let browser;
try {
  const ids = await seed(userId);
  console.log(`[e2e] 临时积累本：A=${ids.bookA}（3 条） B=${ids.bookB}（1 条）`);

  browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await runDesktop(browser, cookies, ids);
  await runMobile(browser, cookies, ids);
} finally {
  if (browser) await browser.close();
  await cleanup();
  await pool.end();
}

console.log(`\n[e2e] ${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
