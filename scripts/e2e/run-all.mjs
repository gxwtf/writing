/**
 * 作文积累本 E2E 主用例集
 *
 * 运行（服务器仓库根目录）：
 *   cd /home/gxwtf/gxwtf_writing && node scripts/e2e/run-all.mjs
 *   # 或 pnpm test:e2e
 *
 * 产物：
 *   /tmp/e2e-writing-<用例ID>.png      失败/关键步骤截图
 *   /tmp/e2e-writing-results.json      结构化结果（供生成 e2e-report.md）
 *   /tmp/e2e-writing-export.pdf        PDF 导出下载
 */
import { writeFileSync, statSync } from 'node:fs';
import {
  BASE, ENTRIES, ACCOUNT, SYSTEM, COOKIE_NAME, creds,
  launchBrowser, newContextWithCookies, loginViaSso, attachLogging,
  waitAppReady, waitEntriesReady, readCounts, cards, cardByText, cardTexts,
  shot, dbConnect, dbAll, dbOne,
} from './lib.mjs';

// ---------------------------------------------------------------- 全局状态

const runId = 'r' + Date.now().toString(36);
const RUN_START = new Date().toISOString();
const TAG_A = `E2E标签A-${runId}`;
const TAG_B = `E2E标签B-${runId}`;
const TAG_UNUSED = `E2E待删标签-${runId}`;
const TAG_USED = `E2E使用中标签-${runId}`;
const TAG_SESSION = `E2E实时标签-${runId}`;

const results = [];
const logs = [];
const contexts = [];
const alerts = [];
let page;      // 当前截图/断言用的页面
let shotPage;  // 截图目标
let browser;
let db;
let userId;
let baseline = {};

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}
const j = (v) => JSON.stringify(v);

async function test(id, name, fn) {
  const started = Date.now();
  const rec = { id, name, status: 'PASS', detail: '', screenshot: null, durationMs: 0 };
  try {
    await fn(rec);
  } catch (e) {
    rec.status = 'FAIL';
    rec.detail = String(e?.message || e).slice(0, 2000);
  } finally {
    rec.durationMs = Date.now() - started;
    rec.screenshot = await shot(shotPage || page, id);
    results.push(rec);
    console.log(`${rec.status === 'PASS' ? 'PASS' : 'FAIL'} ${id} ${name} (${rec.durationMs}ms)`);
    if (rec.status === 'FAIL') console.log(`     ↳ ${rec.detail.replace(/\n/g, '\n       ')}`);
    // 防止失败用例把弹窗留在页面上，污染后续用例
    try { await ensureClean(); } catch {}
  }
}

// ---------------------------------------------------------------- 数据辅助

async function userRows() {
  return dbAll(
    db,
    `select e.id, e.content, e.note, e."createdAt", e."updatedAt",
            coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
       from "WritingEntry" e
       left join "WritingEntryTag" wt on wt."writingEntryId" = e.id
       left join "Tag" t on t.id = wt."tagId"
      where e."userId" = $1
      group by e.id
      order by e.id`,
    [userId]
  );
}

async function entryByContent(content) {
  return dbOne(
    db,
    `select id, content, note, subject, "createdAt", "updatedAt"
       from "WritingEntry" where "userId" = $1 and content = $2 order by id desc limit 1`,
    [userId, content]
  );
}

async function tagsOf(entryId) {
  const rows = await dbAll(
    db,
    `select t.name from "WritingEntryTag" wt join "Tag" t on t.id = wt."tagId"
      where wt."writingEntryId" = $1 order by t.name`,
    [entryId]
  );
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------- UI 辅助

async function mainPage() {
  page = await ctxMain.newPage();
  shotPage = page;
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  attachLogging(page, logs, 'main');
  page.on('dialog', async (d) => {
    alerts.push({ type: d.type(), message: d.message() });
    await d.dismiss().catch(() => {});
  });
  return page;
}

async function refresh() {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitAppReady(page);
}

async function setSearch(term) {
  await page.locator('#writing-search').fill(term);
  await page.waitForTimeout(250);
}

async function clearSearch() {
  await setSearch('');
}

async function counts() {
  return readCounts(page);
}

async function openAddModal() {
  // 精确匹配页面级「添加积累」，避免误匹配弹窗内禁用的提交按钮「添加」
  await page.getByRole('button', { name: '添加积累', exact: true }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible' });
  return dlg;
}

/** 轮询等待条件成立 */
async function waitFor(fn, msg, timeout = 10000, interval = 300) {
  const end = Date.now() + timeout;
  let lastErr;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (e) {
      lastErr = e;
    }
    await page.waitForTimeout(interval);
  }
  throw new Error(msg + (lastErr ? `（${String(lastErr.message).slice(0, 200)}）` : ''));
}

/** 关闭所有弹窗与工具栏下拉；无法关闭时刷新页面，避免用例间相互污染 */
async function ensureClean() {
  if (!page) return;
  // 先关弹窗（弹窗打开时点外部无效）
  for (let i = 0; i < 3; i++) {
    if ((await page.getByRole('dialog').count()) === 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  if ((await page.getByRole('dialog').count()) > 0) {
    await refresh().catch(() => {});
    return;
  }
  // 再关闭工具栏下拉（点击空白处触发外部点击关闭）
  for (let i = 0; i < 2; i++) {
    const openDd = page.locator('[data-filter-dropdown-inner]:visible, [data-batch-dropdown-inner]:visible');
    if ((await openDd.count()) === 0) break;
    await page.locator('h1').first().click({ position: { x: 2, y: 2 }, force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function closeEntryModal() {
  for (let i = 0; i < 3; i++) {
    if ((await page.getByRole('dialog').count()) === 0) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await ensureClean();
}

async function addEntry({ content, note, tags = [] }) {
  await ensureClean();
  await clearSearch();
  const dlg = await openAddModal();
  await dlg.locator('textarea').nth(0).fill(content);
  if (note) await dlg.locator('textarea').nth(1).fill(note);
  for (const t of tags) {
    await dlg.getByText(t, { exact: true }).first().click();
  }
  const submit = dlg.getByRole('button', { name: '添加', exact: true });
  await waitFor(async () => !(await submit.isDisabled()), '内容填写后「添加」按钮仍为禁用');
  await submit.click();
  await dlg.waitFor({ state: 'hidden', timeout: 20000 });
  await cardByText(page, content).waitFor({ timeout: 25000 });
}

async function card(content) {
  const c = cardByText(page, content);
  await c.waitFor({ timeout: 15000 });
  return c;
}

async function cardActions(content) {
  const c = await card(content);
  return c.locator('[data-action-bar] button');
}

/** 等待「标签管理」弹窗出现 */
async function waitTagDialog() {
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible' });
  await dlg
    .locator('[data-slot="dialog-title"]')
    .filter({ hasText: '标签管理' })
    .waitFor({ timeout: 10000 });
  return dlg;
}

/**
 * 从已打开的「添加/批量」弹窗进入标签管理。
 * 修复后（commit f4a3ed9）新增/改色/改名/删除后「标签管理」保持打开，可连续操作。
 */
async function openTagManagerFromEntryModal() {
  const entryDlg = page.getByRole('dialog');
  await entryDlg.getByRole('button', { name: /标签管理|^标签$/ }).first().click();
  return waitTagDialog();
}

async function tagConfigCount(name) {
  return Number(
    (await dbOne(db, 'select count(*)::int c from "TagConfig" where "userId" = $1 and name = $2', [userId, name])).c
  );
}

/** 通过 UI 新增一个标签（「标签管理」保持打开，返回该弹窗供连续操作） */
async function uiAddTagFromOpenEntryModal(name) {
  const tagDlg = await openTagManagerFromEntryModal();
  await tagDlg.locator('input[placeholder="新标签名称"]').fill(name);
  await tagDlg.getByRole('button', { name: /^添加$/ }).click();
  await page.waitForTimeout(400);
  await waitFor(async () => (await tagConfigCount(name)) === 1, `标签「${name}」未写入 TagConfig`);
  return tagDlg;
}

/** 关闭「标签管理」弹窗（点「完成」），回到入口弹窗 */
async function closeTagManager(tagDlg) {
  if (await tagDlg.getByRole('button', { name: '完成' }).count()) {
    await tagDlg.getByRole('button', { name: '完成' }).click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** 打开添加弹窗 → 连续创建多个标签 → 关闭弹窗 */
async function uiCreateTags(names) {
  await ensureClean();
  await openAddModal();
  const tagDlg = await openTagManagerFromEntryModal();
  for (const n of names) {
    await tagDlg.locator('input[placeholder="新标签名称"]').fill(n);
    await tagDlg.getByRole('button', { name: /^添加$/ }).click();
    await page.waitForTimeout(400);
    await waitFor(async () => (await tagConfigCount(n)) === 1, `标签「${n}」未写入 TagConfig`);
  }
  await closeTagManager(tagDlg);
  await closeEntryModal();
}

// 标签管理弹窗中的单行（避免匹配到 DialogContent 自身）
function tagRow(dlg, name) {
  return dlg.locator('div.items-center.justify-between.rounded-lg').filter({ hasText: name }).first();
}

async function openFilter() {
  await page.locator('[data-filter-button]').first().click();
  // 桌面端与移动端工具栏各渲染一份下拉，取可见的那份
  const dd = page.locator('[data-filter-dropdown-inner]:visible').first();
  await dd.waitFor({ state: 'visible' });
  return dd;
}

async function toggleFilterTag(dd, name) {
  await dd.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function closeFilter() {
  for (let i = 0; i < 3; i++) {
    if ((await page.locator('[data-filter-dropdown-inner]:visible').count()) === 0) return;
    await page.locator('h1').first().click({ position: { x: 2, y: 2 }, force: true }).catch(() => {});
    await page.waitForTimeout(250);
    if ((await page.locator('[data-filter-dropdown-inner]:visible').count()) === 0) return;
    await page.mouse.click(1400, 950);
    await page.waitForTimeout(250);
  }
}

async function openBatchMenu() {
  await page.locator('[data-batch-button]').first().click();
  const dd = page.locator('[data-batch-dropdown-inner]:visible').first();
  await dd.waitFor({ state: 'visible' });
  return dd;
}

/** 批量删除确认层（普通 div，不是 Radix Dialog） */
function bulkConfirm() {
  return page.locator('div.fixed.inset-0').filter({ hasText: '确认删除' }).last();
}

async function checkedCount() {
  return page.locator('button[role="checkbox"][data-state="checked"]').count();
}

/** 生产域名请求失败时回退到本机端口（避免证书/网络差异导致误报） */
async function apiGet(path, headers = {}) {
  try {
    return await fetch(`${BASE}${path}`, { headers });
  } catch {
    return await fetch(`http://127.0.0.1:3004${path}`, { headers });
  }
}

// ---------------------------------------------------------------- 主流程

async function main() {
  browser = await launchBrowser();
  db = await dbConnect();

  // ---------- 环境基线 ----------
  baseline = {
    entries: Number((await dbOne(db, 'select count(*)::int c from "WritingEntry"')).c),
    entryTags: Number((await dbOne(db, 'select count(*)::int c from "WritingEntryTag"')).c),
    tags: Number((await dbOne(db, 'select count(*)::int c from "Tag"')).c),
    tagConfigs: Number((await dbOne(db, 'select count(*)::int c from "TagConfig"')).c),
    users: Number((await dbOne(db, 'select count(*)::int c from "User"')).c),
  };
  console.log(`runId=${runId} baseline=${j(baseline)}\n`);

  const sso = await loginViaSso();
  userId = sso.userId;
  console.log(`SSO 登录成功 userId=${userId}\n`);

  // ---------- A. 未登录 / 登录 ----------
  const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  contexts.push(anonCtx);
  const anon = await anonCtx.newPage();
  anon.setDefaultNavigationTimeout(60000);

  await test('A1', '未登录访问首页显示登录落地页', async () => {
    shotPage = anon;
    await anon.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitAppReady(anon);
    ok(await anon.getByText(/收藏好句好段/).first().isVisible(), '未显示副标题「收藏好句好段…」');
    ok(await anon.getByRole('button', { name: '使用广学账号登录' }).isVisible(), '未显示「使用广学账号登录」按钮');
    eq(await anon.getByRole('button', { name: /打开我的积累本/ }).count(), 0, '未登录页不应出现「打开我的积累本」按钮');
    eq(await cards(anon).count(), 0, '未登录页不应出现作文卡片');
  });

  await test('A2', '点击登录跳转广学账号 SSO', async () => {
    shotPage = anon;
    await anon.getByRole('button', { name: '使用广学账号登录' }).click();
    await anon.waitForURL((u) => u.hostname === new URL(ACCOUNT).hostname, { timeout: 45000 });
    eq(new URL(anon.url()).hostname, new URL(ACCOUNT).hostname, '未跳转到账号域名');
  });

  await test('A3', '伪造会话 Cookie 不能绕过登录', async () => {
    const badCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    contexts.push(badCtx);
    await badCtx.addCookies([{
      name: COOKIE_NAME, value: 'forged-session-value-deadbeef',
      domain: SYSTEM, path: '/', httpOnly: true, secure: true,
    }]);
    const p = await badCtx.newPage();
    shotPage = p;
    await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitAppReady(p);
    ok(await p.getByRole('button', { name: '使用广学账号登录' }).isVisible(), '伪造 Cookie 后仍显示已登录');
    eq(await cards(p).count(), 0, '伪造 Cookie 不应加载数据');
  });

  // ---------- 登录后的主会话 ----------
  ctxMain = await newContextWithCookies(browser, sso.cookies);
  contexts.push(ctxMain);
  await mainPage();

  await test('A4', 'SSO 登录后进入列表并显示用户信息', async () => {
    shotPage = page;
    await page.goto(ENTRIES, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitAppReady(page);
    await waitEntriesReady(page);
    // 测试账号来自 creds.json / GX_IDENT，不要硬编码用户名（账号会换）
    const expectedUser = creds().identifier;
    ok(await page.getByText(expectedUser).first().isVisible(), '导航未显示登录用户名');
    const u = await dbOne(db, 'select id, "userId", "userName" from "User" where "userId" = $1', [userId]);
    ok(u, 'User 表未创建该账号行');
    eq(u.userName, expectedUser, 'User.userName 不一致');
  });

  await test('B1', '列表加载与计数和数据库一致', async () => {
    shotPage = page;
    const dbCount = Number((await dbOne(db, 'select count(*)::int c from "WritingEntry" where "userId" = $1', [userId])).c);
    const c = await counts();
    eq(c.total, dbCount, `UI 总数与数据库不一致（DB=${dbCount}）`);
    ok(baseline.entries >= 56, `迁移基线应 ≥ 56，实际 ${baseline.entries}`);
    ok(c.filtered === c.total, '未筛选时符合条件数应等于总数');
  });

  await test('B2', '迁移数据完整性（孤儿/重复/序列）', async () => {
    const orphanUser = Number((await dbOne(db,
      'select count(*)::int c from "WritingEntry" e left join "User" u on u."userId" = e."userId" where u.id is null')).c);
    eq(orphanUser, 0, '存在 userId 无对应用户的作文');
    const orphanEntry = Number((await dbOne(db,
      'select count(*)::int c from "WritingEntryTag" wt left join "WritingEntry" e on e.id = wt."writingEntryId" where e.id is null')).c);
    eq(orphanEntry, 0, '存在指向不存在作文的标签关联');
    const orphanTag = Number((await dbOne(db,
      'select count(*)::int c from "WritingEntryTag" wt left join "Tag" t on t.id = wt."tagId" where t.id is null')).c);
    eq(orphanTag, 0, '存在指向不存在标签的关联');
    const dup = Number((await dbOne(db,
      'select count(*)::int c from (select "writingEntryId","tagId" from "WritingEntryTag" group by 1,2 having count(*)>1) x')).c);
    eq(dup, 0, '存在重复 (writingEntryId, tagId) 关联');
    for (const [seq, table, col] of [
      ['WritingEntry_id_seq', 'WritingEntry', 'id'],
      ['WritingEntryTag_id_seq', 'WritingEntryTag', 'id'],
      ['Tag_id_seq', 'Tag', 'id'],
      ['User_id_seq', 'User', 'id'],
    ]) {
      const maxId = Number((await dbOne(db, `select coalesce(max("${col}"),0)::int m from "${table}"`)).m);
      const seqRow = await dbOne(db, `select last_value::bigint last_value, is_called from "${seq}"`);
      ok(seqRow, `序列 "${seq}" 不存在或无法读取`);
      ok(
        Number(seqRow.last_value) >= maxId,
        `序列 "${seq}" 落后于最大 id（max=${maxId}, last=${seqRow.last_value}）`
      );
    }
  });

  await test('B3', '跨账号数据隔离（搜索他人内容无结果）', async () => {
    shotPage = page;
    await setSearch('Reading helps me see the world anew');
    const c = await counts();
    eq(c.filtered, 0, '搜索其他账号的作文内容不应有结果');
    eq(await cards(page).count(), 0, '不应渲染他人作文卡片');
    await clearSearch();
  });

  // ---------- F. 标签管理 ----------
  await test('F1', '新增标签写入 TagConfig 并出现在界面', async (rec) => {
    shotPage = page;
    await uiCreateTags([TAG_A, TAG_B]);
    const rows = await dbAll(db,
      'select name, "colorId" from "TagConfig" where "userId" = $1 and name in ($2,$3) order by name', [userId, TAG_A, TAG_B]);
    eq(rows.length, 2, 'TagConfig 未写入两条新标签');
    await refresh();
    const dd = await openFilter();
    ok(await dd.getByText(TAG_A, { exact: true }).first().isVisible(), '筛选下拉未出现新标签 A');
    ok(await dd.getByText(TAG_B, { exact: true }).first().isVisible(), '筛选下拉未出现新标签 B');
    await closeFilter();
    rec.detail = '回归点：标签管理弹窗连续操作（一次打开内新增 2 个标签）通过，OBS-1 已修复';
  });

  await test('F2', '重复标签名不产生重复配置', async () => {
    shotPage = page;
    const before = Number((await dbOne(db, 'select count(*)::int c from "TagConfig" where "userId" = $1', [userId])).c);
    await openAddModal();
    const dlg = await openTagManagerFromEntryModal();
    const input = dlg.locator('input[placeholder="新标签名称"]');
    await input.fill(TAG_A);
    await dlg.getByRole('button', { name: /^添加$/ }).click();
    await page.waitForTimeout(700);
    const after = Number((await dbOne(db, 'select count(*)::int c from "TagConfig" where "userId" = $1', [userId])).c);
    eq(after, before, '重复标签名新增了配置');
    await closeEntryModal();
  });

  await test('F3', '修改标签颜色持久化', async () => {
    shotPage = page;
    await openAddModal();
    const dlg = await openTagManagerFromEntryModal();
    const row = tagRow(dlg, TAG_A);
    await row.locator('button').nth(0).click(); // 铅笔进入编辑
    // 编辑态的行通过「更改颜色」按钮唯一定位
    const editRow = dlg.locator('div.items-center.justify-between.rounded-lg').filter({
      has: page.locator('button[title="更改颜色"]'),
    }).first();
    await editRow.locator('button[title="更改颜色"]').click();
    const colorDlg = page.getByRole('dialog');
    await colorDlg.waitFor({ state: 'visible' });
    await colorDlg.getByText('紫色', { exact: true }).first().click();
    await colorDlg.getByRole('button', { name: '确认' }).click();
    await page.waitForTimeout(400);
    await editRow.getByRole('button', { name: '保存' }).click();
    await waitFor(
      async () => (await dbOne(db, 'select "colorId" from "TagConfig" where "userId" = $1 and name = $2', [userId, TAG_A]))?.colorId === 'purple',
      'TagConfig.colorId 未更新为 purple'
    );
    await closeEntryModal();
  });

  await test('F4', '删除未使用标签', async () => {
    shotPage = page;
    await uiCreateTags([TAG_UNUSED]);
    eq(await tagConfigCount(TAG_UNUSED), 1, '前置标签未创建');
    await openAddModal();
    const dlg = await openTagManagerFromEntryModal();
    await tagRow(dlg, TAG_UNUSED).locator('button').nth(1).click(); // 垃圾桶
    const confirm = page.getByRole('dialog');
    await confirm.waitFor({ state: 'visible' });
    await confirm.getByRole('button', { name: '删除', exact: true }).click();
    await waitFor(async () => (await tagConfigCount(TAG_UNUSED)) === 0, 'TagConfig 未删除');
    eq(await page.getByText(TAG_UNUSED, { exact: true }).count(), 0, '界面仍显示已删除标签');
    await closeEntryModal();
  });

  // ---------- C. 新增 ----------
  const C1_CONTENT = `Alpha E2E ${runId} 内容一`;
  const C1_NOTE = `备注一 ${runId}`;

  await test('C1', '新增作文（内容+备注+两个标签）落库并可见', async () => {
    shotPage = page;
    await addEntry({ content: C1_CONTENT, note: C1_NOTE, tags: [TAG_A, TAG_B] });
    const row = await entryByContent(C1_CONTENT);
    ok(row, '数据库未找到新增作文');
    eq(row.note, C1_NOTE, 'note 未正确保存');
    eq(row.subject, 'english', 'subject 应默认为 english');
    const tags = await tagsOf(row.id);
    eq(tags.length, 2, 'WritingEntryTag 数量不对');
    ok(tags.includes(TAG_A) && tags.includes(TAG_B), `标签落库错误：${j(tags)}`);
    const c = await card(C1_CONTENT);
    ok((await c.innerText()).includes(C1_NOTE), '卡片未显示备注');
  });

  await test('C2', '内容为空/全空格时禁用提交', async () => {
    shotPage = page;
    const dlg = await openAddModal();
    const submit = dlg.getByRole('button', { name: '添加', exact: true });
    eq(await submit.isDisabled(), true, '空内容时「添加」按钮应为禁用');
    await dlg.locator('textarea').nth(0).fill('   ');
    eq(await submit.isDisabled(), true, '全空格内容时「添加」按钮应为禁用');
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden' }).catch(() => {});
  });

  const C3_CONTENT = `Bravo E2E ${runId} 仅内容`;

  await test('C3', '仅内容新增（note 为空、无标签）', async () => {
    shotPage = page;
    await addEntry({ content: C3_CONTENT });
    const row = await entryByContent(C3_CONTENT);
    ok(row, '数据库未找到新增作文');
    eq(row.note, null, 'note 应为 NULL');
    eq((await tagsOf(row.id)).length, 0, '不应有标签关联');
    const c = await card(C3_CONTENT);
    ok((await c.innerText()).includes('无标签'), '卡片未显示「无标签」');
  });

  const C4_CONTENT = `Zulu E2E ${runId} 尾部空格`;

  await test('C4', '内容尾部空白被裁剪', async () => {
    shotPage = page;
    await addEntry({ content: C4_CONTENT + '   ' });
    const row = await entryByContent(C4_CONTENT);
    ok(row, '数据库未找到裁剪尾部空白后的内容');
    eq(row.content, C4_CONTENT, 'content 尾部空白未裁剪');
  });

  const C5_CONTENT = `Charlie E2E ${runId} <b>bold</b> & "quotes" 😀`;

  await test('C5', '特殊字符按纯文本显示（XSS 安全）', async () => {
    shotPage = page;
    await addEntry({ content: C5_CONTENT });
    const row = await entryByContent(C5_CONTENT);
    ok(row, '数据库未找到特殊字符内容');
    const c = await card(C5_CONTENT);
    const t = await c.locator('h3').innerText();
    eq(t.trim(), C5_CONTENT, '卡片文本与输入不一致');
    eq(await c.locator('h3 b').count(), 0, 'HTML 标签被渲染（XSS 风险）');
  });

  // ---------- D. 编辑 ----------
  const D1_CONTENT = `${C1_CONTENT} 编辑后`;

  await test('D1', '编辑内容/备注/标签并落库', async () => {
    shotPage = page;
    const before = await entryByContent(C1_CONTENT);
    ok(before, '前置数据缺失');
    const btn = await cardActions(C1_CONTENT);
    await btn.nth(0).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ state: 'visible' });
    eq(await dlg.locator('[data-slot="dialog-title"]').innerText(), '编辑积累内容', '弹窗标题不对');
    eq(await dlg.locator('textarea').nth(0).inputValue(), C1_CONTENT, '内容未回填');
    eq(await dlg.locator('textarea').nth(1).inputValue(), C1_NOTE, '备注未回填');
    await dlg.locator('textarea').nth(0).fill(D1_CONTENT);
    await dlg.locator('textarea').nth(1).fill(`备注一已改 ${runId}`);
    await dlg.getByText(TAG_A, { exact: true }).first().click(); // 取消 A
    await dlg.getByRole('button', { name: '保存', exact: true }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 20000 });
    await cardByText(page, D1_CONTENT).waitFor({ timeout: 20000 });
    const after = await entryByContent(D1_CONTENT);
    ok(after, '数据库未更新内容');
    eq(after.note, `备注一已改 ${runId}`, '备注未更新');
    ok(new Date(after.updatedAt) > new Date(before.updatedAt), 'updatedAt 未更新');
    const tags = await tagsOf(after.id);
    eq(j(tags), j([TAG_B]), `标签替换不正确：${j(tags)}`);
  });

  await test('D2', '编辑后取消不产生变更', async () => {
    shotPage = page;
    const before = await entryByContent(D1_CONTENT);
    const btn = await cardActions(D1_CONTENT);
    await btn.nth(0).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ state: 'visible' });
    const prefix = '取消测试-';
    await dlg.locator('textarea').nth(0).fill(prefix + D1_CONTENT);
    await dlg.getByRole('button', { name: '取消', exact: true }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 15000 });
    const after = await entryByContent(D1_CONTENT);
    ok(after, '原内容消失');
    ok(!(await entryByContent(prefix + D1_CONTENT)), '取消后仍写入了数据库');
    eq(await cardTexts(page).then((ts) => ts.filter((t) => t.includes(prefix)).length), 0, '取消后界面出现新内容');
    eq(after.content, before.content, '取消后内容被修改');
  });

  // ---------- E. 单条删除 ----------
  const E_CONTENT = `Delta E2E ${runId} 待删除`;

  await test('E1', '单条删除第一次点击进入二次确认', async () => {
    shotPage = page;
    await addEntry({ content: E_CONTENT });
    const row = await entryByContent(E_CONTENT);
    ok(row, '前置数据缺失');
    const btn = await cardActions(E_CONTENT);
    await btn.nth(1).click();
    await (await card(E_CONTENT)).getByText('再次点击确认删除').waitFor({ timeout: 8000 });
    ok(await entryByContent(E_CONTENT), '第一次点击就删除了记录');
  });

  await test('E2', '再次点击确认后记录删除并级联清理', async () => {
    shotPage = page;
    const row = await entryByContent(E_CONTENT);
    ok(row, '前置数据缺失');
    const btn = await cardActions(E_CONTENT);
    await btn.nth(1).click();
    await page.waitForTimeout(1200);
    ok(!(await entryByContent(E_CONTENT)), '数据库记录未删除');
    eq(await cards(page).filter({ hasText: E_CONTENT }).count(), 0, '界面仍显示已删除卡片');
    eq((await tagsOf(row.id)).length, 0, '标签关联未级联清理');
  });

  const E3_CONTENT = `Echo E2E ${runId} 防误删`;

  await test('E3', '确认态 3 秒后自动取消，记录保留', async () => {
    shotPage = page;
    await addEntry({ content: E3_CONTENT });
    const btn = await cardActions(E3_CONTENT);
    await btn.nth(1).click();
    await (await card(E3_CONTENT)).getByText('再次点击确认删除').waitFor({ timeout: 8000 });
    await page.waitForTimeout(3400);
    eq(await (await card(E3_CONTENT)).getByText('再次点击确认删除').count(), 0, '确认提示未自动消失');
    ok(await entryByContent(E3_CONTENT), '超时后记录被删除');
    // 清理：正常删除
    await cardActions(E3_CONTENT).then((b) => b.nth(1).click());
    await page.waitForTimeout(400);
    await cardActions(E3_CONTENT).then((b) => b.nth(1).click());
    await page.waitForTimeout(1200);
    ok(!(await entryByContent(E3_CONTENT)), '清理删除失败');
  });

  // ---------- G. 搜索 / 筛选 / 排序 ----------
  const S_A = `Alpha Search ${runId} 关键词alpha`;
  const S_B = `Bravo Search ${runId} 关键词beta`;
  const S_C = `Delta Search ${runId} 关键词alpha 关键词beta`;
  const S_NOTE = `备注检索词 notematch-${runId}`;

  await test('G0', '准备检索数据集', async () => {
    shotPage = page;
    await addEntry({ content: S_A, tags: [TAG_A] });
    await addEntry({ content: S_B, note: S_NOTE, tags: [TAG_B] });
    await addEntry({ content: S_C, tags: [TAG_A, TAG_B] });
    eq((await userRows()).filter((r) => r.content.includes(runId)).length > 0, true, '数据集为空');
  });

  await test('G1', '搜索命中内容并收敛结果', async () => {
    shotPage = page;
    await setSearch(runId);
    const expected = (await userRows()).filter((r) => r.content.toLowerCase().includes(runId.toLowerCase())).length;
    const c = await counts();
    eq(c.filtered, expected, '搜索结果数量与数据库不一致');
    eq(await cards(page).count(), expected, '卡片数量与搜索结果不一致');
    for (const t of await cardTexts(page)) ok(t.includes(runId), `出现不匹配卡片：${t.slice(0, 60)}`);
  });

  await test('G2', '搜索命中备注（note 参与检索）', async () => {
    shotPage = page;
    await setSearch(`notematch-${runId}`);
    const c = await counts();
    eq(c.filtered, 1, '备注检索应命中 1 条');
    const texts = await cardTexts(page);
    eq(texts.length, 1, '界面卡片数不为 1');
    eq(texts[0].trim(), S_B, '命中的不是预期条目');
  });

  await test('G3', '搜索无结果显示空状态', async () => {
    shotPage = page;
    await setSearch(`no-such-term-${runId}-xyz`);
    const c = await counts();
    eq(c.filtered, 0, '无结果时计数应为 0');
    // 无结果文案分两种：有数据但筛选为空 / 完全没有数据
    const emptyText = c.total === 0 ? '还没有添加任何积累内容' : '没有符合条件的积累内容';
    ok(await page.getByText(emptyText).isVisible(), `未显示空状态提示「${emptyText}」`);
  });

  await test('G4', '标签筛选「且」', async () => {
    shotPage = page;
    await clearSearch();
    const dd = await openFilter();
    await toggleFilterTag(dd, TAG_A);
    await toggleFilterTag(dd, TAG_B);
    const c = await counts();
    const rows = await userRows();
    const expected = rows.filter((r) => r.tags.includes(TAG_A) && r.tags.includes(TAG_B)).length;
    eq(c.filtered, expected, `「且」筛选数量不符（DB=${expected}）`);
    ok((await dd.getByRole('button', { name: '全部满足' }).count()) === 1, '筛选逻辑应显示「全部满足」');
    await closeFilter();
  });

  await test('G5', '标签筛选「或」', async () => {
    shotPage = page;
    const dd = await openFilter();
    await dd.getByRole('button', { name: '全部满足' }).click();
    await page.waitForTimeout(400);
    const c = await counts();
    const rows = await userRows();
    const expected = rows.filter((r) => r.tags.includes(TAG_A) || r.tags.includes(TAG_B)).length;
    eq(c.filtered, expected, `「或」筛选数量不符（DB=${expected}）`);
    ok((await dd.getByRole('button', { name: '任一满足' }).count()) === 1, '筛选逻辑应显示「任一满足」');
    // 重置筛选
    await dd.getByText(TAG_A, { exact: true }).first().click();
    await dd.getByText(TAG_B, { exact: true }).first().click();
    await page.waitForTimeout(400);
    await closeFilter();
  });

  await test('G6', '首字母排序', async () => {
    shotPage = page;
    await setSearch(runId);
    await page.getByRole('button', { name: '首字母排序' }).first().click();
    await page.waitForTimeout(400);
    const ui = (await cardTexts(page)).map((t) => t.trim());
    const expected = (await userRows())
      .map((r) => r.content)
      .filter((c) => c.toLowerCase().includes(runId.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en'));
    eq(j(ui), j(expected), '首字母排序结果与预期不符');
  });

  await test('G7', '恢复默认排序（createdAt 倒序）', async () => {
    shotPage = page;
    await page.getByRole('button', { name: '默认', exact: true }).first().click();
    await page.waitForTimeout(400);
    const ui = (await cardTexts(page)).map((t) => t.trim());
    const expected = (await userRows())
      .filter((r) => r.content.toLowerCase().includes(runId.toLowerCase()))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((r) => r.content);
    eq(j(ui), j(expected), '默认排序（创建时间倒序）不符');
    await clearSearch();
  });

  // ---------- F5. 使用中标签删除 ----------
  const F5_CONTENT = `Foxtrot E2E ${runId} 使用中标签`;

  await test('F5', '删除使用中的标签：提示引用数并级联清理', async () => {
    shotPage = page;
    // 新建标签并用于一条作文（先刷新，使标签 key 归一为显示名）
    await uiCreateTags([TAG_USED]);
    await refresh();
    await addEntry({ content: F5_CONTENT, tags: [TAG_USED] });
    const row = await entryByContent(F5_CONTENT);
    eq(j(await tagsOf(row.id)), j([TAG_USED]), '标签未正确关联');

    await openAddModal();
    const dlg = await openTagManagerFromEntryModal();
    await tagRow(dlg, TAG_USED).locator('button').nth(1).click(); // 垃圾桶
    const confirm = page.getByRole('dialog');
    await confirm.waitFor({ state: 'visible' });
    await page.getByText('该标签正在被使用').waitFor({ timeout: 8000 });
    await confirm.getByRole('button', { name: '删除', exact: true }).click();
    await waitFor(async () => (await tagConfigCount(TAG_USED)) === 0, 'TagConfig 未删除');
    eq(await dbOne(db, 'select count(*)::int c from "Tag" where name = $1', [TAG_USED]).then((r) => r.c), 0, 'Tag 未删除');
    ok(await entryByContent(F5_CONTENT), '作文不应被删除');
    eq(j(await tagsOf(row.id)), '[]', '标签关联未级联删除');
    await closeEntryModal();
  });

  // ---------- F6. 标签改名 ----------
  const RENAME_OLD = `E2E改名-${runId}`;
  const RENAME_NEW = `E2E改名后-${runId}`;
  const F6_CONTENT = `Lima E2E ${runId} 改名标签`;

  await test('F6', '标签改名：Tag/TagConfig/作文显示/筛选同步', async () => {
    shotPage = page;
    // 1) 新建标签并用于一条作文
    await uiCreateTags([RENAME_OLD]);
    await addEntry({ content: F6_CONTENT, tags: [RENAME_OLD] });
    const entry = await entryByContent(F6_CONTENT);
    ok(entry, '前置作文未创建');
    eq(j(await tagsOf(entry.id)), j([RENAME_OLD]), '前置标签未正确关联');

    // 2) 在标签管理中改名
    await openAddModal();
    const tagDlg = await openTagManagerFromEntryModal();
    await tagRow(tagDlg, RENAME_OLD).locator('button').nth(0).click(); // 铅笔
    const editRow = tagDlg
      .locator('div.items-center.justify-between.rounded-lg')
      .filter({ has: page.locator('input') })
      .first();
    await editRow.locator('input').fill(RENAME_NEW);
    await editRow.getByRole('button', { name: '保存' }).click();
    await page.waitForTimeout(1200);

    // (c) DB：Tag.name / TagConfig.name 均为新名，旧名无残留
    eq(await dbOne(db, 'select count(*)::int c from "Tag" where name = $1', [RENAME_NEW]).then((r) => r.c), 1, 'Tag.name 未更新为新名');
    eq(await dbOne(db, 'select count(*)::int c from "Tag" where name = $1', [RENAME_OLD]).then((r) => r.c), 0, 'Tag 旧名残留');
    eq(await tagConfigCount(RENAME_NEW), 1, 'TagConfig 未更新为新名');
    eq(await tagConfigCount(RENAME_OLD), 0, 'TagConfig 旧名残留');
    // (a) 已有作文的关联自动显示新名（tagId 关联不变）
    eq(j(await tagsOf(entry.id)), j([RENAME_NEW]), '作文标签未同步新名');

    // (b) 关闭弹窗并刷新后：卡片与筛选均为新名
    await closeEntryModal();
    await refresh();
    const cardTextNow = await (await card(F6_CONTENT)).innerText();
    ok(cardTextNow.includes(RENAME_NEW), `卡片未显示新标签名：${cardTextNow.replace(/\n/g, ' | ').slice(0, 200)}`);
    ok(!cardTextNow.includes(RENAME_OLD), '卡片仍显示旧标签名');
    const dd = await openFilter();
    ok(await dd.getByText(RENAME_NEW, { exact: true }).first().isVisible(), '筛选下拉未显示新标签名');
    eq(await dd.getByText(RENAME_OLD, { exact: true }).count(), 0, '筛选下拉仍显示旧标签名');
    await closeFilter();
  });

  // ---------- F1b. 同会话新增标签立即使用 ----------
  const F1B_CONTENT = `Golf E2E ${runId} 实时标签`;

  await test('F1b', '同会话新增标签后立即用于作文（应落库为显示名）', async () => {
    shotPage = page;
    const dlgAdd = await openAddModal();
    const tagDlg = await uiAddTagFromOpenEntryModal(TAG_SESSION);
    await closeTagManager(tagDlg); // 回到添加弹窗
    await dlgAdd.locator('textarea').nth(0).fill(F1B_CONTENT);
    await dlgAdd.getByText(TAG_SESSION, { exact: true }).first().click();
    const submit = dlgAdd.getByRole('button', { name: '添加', exact: true });
    await waitFor(async () => !(await submit.isDisabled()), '内容填写后「添加」按钮仍为禁用');
    await submit.click();
    await dlgAdd.waitFor({ state: 'hidden', timeout: 20000 });
    await cardByText(page, F1B_CONTENT).waitFor({ timeout: 20000 });
    const row = await entryByContent(F1B_CONTENT);
    ok(row, '数据库未找到新增作文');
    const tags = await tagsOf(row.id);
    eq(tags.length, 1, `标签关联数量不对：${j(tags)}`);
    eq(tags[0], TAG_SESSION, `标签名落库错误：实际「${tags[0]}」，期望显示名「${TAG_SESSION}」`);
    // 刷新后卡片显示同样应为显示名
    await refresh();
    const cardText = await (await card(F1B_CONTENT)).innerText();
    ok(cardText.includes(TAG_SESSION), `刷新后卡片未显示显示名：${cardText.replace(/\n/g, ' | ').slice(0, 200)}`);
  });

  // ---------- H. 批量操作 ----------
  const B1_CONTENT = `Hotel Batch ${runId} 批量一`;
  const B2_CONTENT = `India Batch ${runId} 批量二`;
  const B3_CONTENT = `Juliet Batch ${runId} 批量三`;
  const B4_CONTENT = `Kilo Batch ${runId} 批量四`;

  await test('H0', '准备批量数据集', async () => {
    shotPage = page;
    for (const c of [B1_CONTENT, B2_CONTENT, B3_CONTENT, B4_CONTENT]) await addEntry({ content: c });
    await setSearch(runId);
    ok((await cards(page).count()) >= 4, '批量数据集不足 4 条');
  });

  await test('H1', '全选选中当前筛选结果', async () => {
    shotPage = page;
    const c = await counts();
    await page.getByRole('button', { name: '全选', exact: true }).first().click();
    await page.waitForTimeout(500);
    eq(await checkedCount(), c.filtered, '全选选中数量与筛选结果不一致');
    ok(await page.getByRole('button', { name: '取消全选' }).first().isVisible(), '全选按钮未变为「取消全选」');
    const batchBtn = page.locator('[data-batch-button]').first();
    ok(!(await batchBtn.isDisabled()), '批量操作按钮应可用');
  });

  await test('H2', '取消全选', async () => {
    shotPage = page;
    await page.getByRole('button', { name: '取消全选' }).first().click();
    await page.waitForTimeout(400);
    eq(await checkedCount(), 0, '取消全选后仍有选中项');
    ok(await page.locator('[data-batch-button]').first().isDisabled(), '无选中时批量操作应禁用');
  });

  await test('H3', '区间选择选中首尾区间', async () => {
    shotPage = page;
    const selectAllBtn = page.getByRole('button', { name: '全选', exact: true }).first();
    await selectAllBtn.locator('xpath=following-sibling::button[1]').click(); // ▼ 下拉
    await page.getByRole('menuitem', { name: '区间选择' }).click();
    await page.waitForTimeout(300);
    const list = cards(page);
    await list.nth(0).locator('h3').click();
    await page.waitForTimeout(200);
    await list.nth(2).locator('h3').click();
    await page.waitForTimeout(400);
    eq(await checkedCount(), 3, '区间选择应选中 3 条');
    await refresh();
    await setSearch(runId);
  });

  await test('H4', '批量设置标签（覆盖式）', async () => {
    shotPage = page;
    const sel = [B1_CONTENT, B2_CONTENT];
    for (const content of sel) {
      await cardByText(page, content).locator('button[role="checkbox"]').click();
      await page.waitForTimeout(150);
    }
    const dd = await openBatchMenu();
    await dd.getByText('设置标签', { exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ state: 'visible' });
    await dlg.getByText(TAG_A, { exact: true }).first().click();
    await dlg.getByText(TAG_B, { exact: true }).first().click();
    await dlg.getByRole('button', { name: '应用' }).click();
    await page.waitForTimeout(1500);
    for (const content of sel) {
      const row = await entryByContent(content);
      ok(row, `条目不存在：${content}`);
      eq(j(await tagsOf(row.id)), j([TAG_A, TAG_B].sort()), `批量标签不正确：${content}`);
    }
    await refresh();
    await setSearch(runId);
  });

  await test('H5', '批量删除-取消不做删除', async () => {
    shotPage = page;
    const sel = [B3_CONTENT, B4_CONTENT];
    for (const content of sel) {
      await cardByText(page, content).locator('button[role="checkbox"]').click();
      await page.waitForTimeout(150);
    }
    const dd = await openBatchMenu();
    await dd.getByText('删除选中', { exact: true }).click();
    const confirm = bulkConfirm();
    await confirm.waitFor({ state: 'visible' });
    ok((await confirm.innerText()).includes('2 条'), '确认弹窗未显示删除条数');
    await confirm.getByRole('button', { name: '取消' }).click();
    await confirm.waitFor({ state: 'hidden', timeout: 10000 });
    for (const content of sel) ok(await entryByContent(content), `取消后仍删除了：${content}`);
  });

  await test('H6', '批量删除-确认删除', async () => {
    shotPage = page;
    // H5 取消后选中态保留与否不确定，重新勾选
    for (const content of [B3_CONTENT, B4_CONTENT]) {
      const cb = cardByText(page, content).locator('button[role="checkbox"]');
      if ((await cb.getAttribute('data-state')) !== 'checked') await cb.click();
      await page.waitForTimeout(150);
    }
    const dd = await openBatchMenu();
    await dd.getByText('删除选中', { exact: true }).click();
    const confirm = bulkConfirm();
    await confirm.waitFor({ state: 'visible' });
    await confirm.getByRole('button', { name: '确认删除' }).click();
    await page.waitForTimeout(1500);
    for (const content of [B3_CONTENT, B4_CONTENT]) {
      ok(!(await entryByContent(content)), `批量删除未生效：${content}`);
      eq(await cards(page).filter({ hasText: content }).count(), 0, `界面仍显示：${content}`);
    }
  });

  // ---------- I. PDF 导出 ----------
  await test('I1', '选中条目导出 PDF 触发下载', async () => {
    shotPage = page;
    await clearSearch();
    await setSearch(runId);
    await page.getByRole('button', { name: '全选', exact: true }).first().click();
    await page.waitForTimeout(400);
    const dd = await openBatchMenu();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      dd.getByText('导出 PDF', { exact: true }).click(),
    ]);
    const name = download.suggestedFilename();
    const path = '/tmp/e2e-writing-export.pdf';
    await download.saveAs(path);
    ok(/^作文积累本_\d{8}_\d{6}\.pdf$/.test(name), `PDF 文件名不符：${name}`);
    const size = statSync(path).size;
    ok(size > 5000, `PDF 文件过小：${size} bytes`);
    eq(alerts.length, 0, `出现 alert：${j(alerts)}`);
    await clearSearch();
  });

  // ---------- J. API 权限 ----------
  await test('J1', 'API 无 Authorization 返回 401', async () => {
    const r = await apiGet(`/api/writing-entries?userId=${userId}`);
    eq(r.status, 401, '无鉴权时应返回 401');
    const body = await r.json();
    eq(body.success, false, '应返回 success=false');
  });

  await test('J2', 'API 错误 Key 返回 401', async () => {
    const r = await apiGet(`/api/writing-entries?userId=${userId}`, {
      Authorization: 'Bearer wrong-key',
    });
    eq(r.status, 401, '错误 Key 应返回 401');
  });

  await test('J3', 'API 正确 Key 返回该用户数据', async () => {
    const key = process.env.SECRET_API_KEY;
    ok(key, 'SECRET_API_KEY 未配置，无法执行该用例');
    const r = await apiGet(`/api/writing-entries?userId=${userId}`, {
      Authorization: `Bearer ${key}`,
    });
    eq(r.status, 200, '正确 Key 应返回 200');
    const body = await r.json();
    eq(body.success, true, 'success 应为 true');
    const dbCount = Number((await dbOne(db, 'select count(*)::int c from "WritingEntry" where "userId" = $1', [userId])).c);
    eq(body.count, dbCount, 'API count 与数据库不一致');
  });

  await test('J4', 'API 缺少 userId 返回 400', async () => {
    const key = process.env.SECRET_API_KEY;
    const r = await apiGet('/api/writing-entries', { Authorization: `Bearer ${key}` });
    eq(r.status, 400, '缺少 userId 应返回 400');
  });

  // ---------- K. 回归 ----------
  await test('K1', '全程无未捕获页面异常', async () => {
    const pageErrors = logs.filter((l) => l.kind === 'pageerror');
    eq(pageErrors.length, 0, `出现 ${pageErrors.length} 个未捕获异常：${j(pageErrors.slice(0, 5))}`);
    const consoleErrors = logs.filter((l) => l.kind === 'console.error');
    if (consoleErrors.length) {
      console.log(`     [info] console.error ${consoleErrors.length} 条：${j(consoleErrors.slice(0, 8))}`);
    }
  });

  await test('K2', '刷新后数据持久化', async () => {
    shotPage = page;
    await refresh();
    const dbCount = (await userRows()).length;
    const c = await counts();
    eq(c.total, dbCount, '刷新后计数与数据库不一致');
  });

  await test('K3', '移动端视口基本可用', async () => {
    const mCtx = await browser.newContext({
      viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: false, acceptDownloads: true,
    });
    contexts.push(mCtx);
    await mCtx.addCookies(sso.cookies.map((c) => ({
      name: c.name, value: c.value, domain: c.host, path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
    })));
    const p = await mCtx.newPage();
    shotPage = p;
    await p.goto(ENTRIES, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitAppReady(p);
    await waitEntriesReady(p);
    ok(await p.locator('#writing-search-mobile').isVisible(), '移动端搜索框不可见');
    ok(await p.getByRole('button', { name: /^添加$/ }).first().isVisible(), '移动端添加按钮不可见');
    ok(await p.getByRole('button', { name: '批量操作' }).first().isVisible(), '移动端批量操作按钮不可见');
    shotPage = page;
  });

  await test('K4', '导航「使用文档」指向作文积累本文档', async (rec) => {
    shotPage = page;
    const link = page.locator('a[href*="docs.gxwtf.cn"]').first();
    ok((await link.count()) > 0, '未找到使用文档链接');
    const href = await link.getAttribute('href');
    ok(href.includes('/writing/'), `「使用文档」链接仍指向 ${href}`);
    // 文档站点内容可用性（页面为 docsify hash 路由，直接探测 md 文件）
    const md = await fetch('https://docs.gxwtf.cn/writing/README.md').catch(() => null);
    if (!md || md.status !== 200) {
      rec.detail = `观察项：导航链接已指向 ${href}，但 docs.gxwtf.cn 的 /writing/ 文档内容尚未发布（README.md=${md ? md.status : 'N/A'}）`;
      console.log(`     [info] ${rec.detail}`);
    }
  });

  // ---------- A5. 登出（最后执行） ----------
  await test('A5', '登出清除会话并回到未登录页', async () => {
    shotPage = page;
    await page.getByRole('button', { name: '登出' }).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: '使用广学账号登录' }).waitFor({ timeout: 30000 });
    const remain = (await ctxMain.cookies()).filter((c) => c.name === COOKIE_NAME && c.value);
    eq(remain.length, 0, '登出后会话 Cookie 仍存在');
    const ls = await page.evaluate(() => {
      try { return { auth: localStorage.getItem('gxwtf_writing_auth'), user: localStorage.getItem('gxwtf_writing_user') }; } catch { return {}; }
    });
    ok(!ls.auth && !ls.user, `登出后 localStorage 未清理：${j(ls)}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitAppReady(page);
    ok(await page.getByRole('button', { name: '使用广学账号登录' }).isVisible(), '刷新后仍处于登录态');
  });
}

// ---------------------------------------------------------------- 入口

let ctxMain;
let exitCode = 0;

try {
  await main();
} catch (e) {
  console.error('\n[FATAL] 测试流程异常终止:', e);
  exitCode = 2;
} finally {
  // 汇总
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const payload = {
    runId, startedAt: RUN_START, finishedAt: new Date().toISOString(),
    base: BASE, system: SYSTEM, userId, credsUser: creds().identifier,
    baseline, summary: { total: results.length, passed, failed }, results,
    logs: logs.slice(0, 200), alerts,
    screenshotsDir: '/tmp', pdfPath: '/tmp/e2e-writing-export.pdf',
  };
  try {
    writeFileSync('/tmp/e2e-writing-results.json', JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('写入结果 JSON 失败:', e.message);
  }
  console.log('\n================ 汇总 ================');
  console.log(`用例 ${results.length} 个：PASS ${passed} / FAIL ${failed}`);
  for (const r of results.filter((x) => x.status === 'FAIL')) {
    console.log(`FAIL ${r.id} ${r.name}\n     ↳ ${r.detail.split('\n')[0]}`);
  }
  console.log('结果 JSON：/tmp/e2e-writing-results.json');
  for (const c of contexts) await c.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (db) await db.end().catch(() => {});
}
process.exit(exitCode || (results.some((r) => r.status === 'FAIL') ? 1 : 0));
