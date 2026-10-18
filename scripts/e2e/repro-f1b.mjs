/**
 * F1b 缺陷最小复现脚本（仅复现与取证，不改产品代码）
 *
 * 复现步骤（修复前，commit 44391a9）：
 *  1) 登录 → 点击「添加积累」
 *  2) 弹窗内点「标签管理」→ 输入新标签名「E2E复现标签-<runId>」→ 点「添加」
 *  3) 回到添加弹窗，填写内容，点选刚新增的标签 → 提交
 *  4) 查询数据库：Tag.name 落库为 "custom-e2e复现标签-<runid>"（内部 key），而非显示名
 *  5) 刷新页面：卡片标签显示为 custom-...，与标签管理中的显示名不一致
 *
 * 修复后（commit f4a3ed9）本脚本用于回归：期望 storedTagNames == [显示名]、刷新后卡片显示显示名。
 */
import { writeFileSync } from 'node:fs';
import {
  BASE, launchBrowser, newContextWithCookies, loginViaSso, attachLogging,
  waitAppReady, dbConnect, dbAll, dbOne,
} from './lib.mjs';

const runId = 'bug' + Date.now().toString(36);
const TAG_NAME = `E2E复现标签-${runId}`;
const CONTENT = `BugRepro ${runId} 同会话标签`;
const logs = [];
const evidence = { runId, tagName: TAG_NAME, content: CONTENT, steps: [] };

const browser = await launchBrowser();
const db = await dbConnect();
const { userId, cookies } = await loginViaSso();
const ctx = await newContextWithCookies(browser, cookies);
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
attachLogging(page, logs, 'bug');

const step = (s, data) => {
  evidence.steps.push({ step: s, ...data });
  console.log(`[${s}]`, JSON.stringify(data));
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitAppReady(page);

// 1) 添加弹窗
await page.getByRole('button', { name: '添加积累', exact: true }).first().click();
let dlg = page.getByRole('dialog');
await dlg.waitFor({ state: 'visible' });

// 2) 标签管理 → 新增标签
await dlg.getByRole('button', { name: /标签管理|^标签$/ }).first().click();
let tagDlg = page.getByRole('dialog');
await tagDlg.waitFor({ state: 'visible' });
await tagDlg.locator('input[placeholder="新标签名称"]').fill(TAG_NAME);
await tagDlg.getByRole('button', { name: /^添加$/ }).click();
await page.waitForTimeout(900);
const cfg = await dbAll(db, 'select name,"colorId" from "TagConfig" where "userId"=$1 and name=$2', [userId, TAG_NAME]);
step('2-新增标签后 TagConfig', { tagConfig: cfg });
step('2-新增标签后弹窗状态（修复后应仍停留在「标签管理」）', { dialogs: await page.getByRole('dialog').count(), titles: await page.getByRole('dialog').locator('[data-slot="dialog-title"]').allInnerTexts().catch(() => []) });
await page.screenshot({ path: '/tmp/e2e-writing-bug-f1b-01-addtag.png', fullPage: true });

// 关闭标签管理，回到添加弹窗
const finish = tagDlg.getByRole('button', { name: '完成' });
if (await finish.count()) {
  await finish.click();
  await page.waitForTimeout(500);
}

// 3) 填写内容并选标签
dlg = page.getByRole('dialog');
await dlg.locator('textarea').nth(0).fill(CONTENT);
await dlg.getByText(TAG_NAME, { exact: true }).first().click();
await page.screenshot({ path: '/tmp/e2e-writing-bug-f1b-02-selected.png', fullPage: true });
await dlg.getByRole('button', { name: '添加', exact: true }).click();
await dlg.waitFor({ state: 'hidden', timeout: 20000 });
await page.waitForTimeout(900);

// 4) 数据库中的实际标签名
const row = await dbOne(db, 'select id, content from "WritingEntry" where "userId"=$1 and content=$2', [userId, CONTENT]);
const stored = row
  ? (await dbAll(db, 'select t.name from "WritingEntryTag" wt join "Tag" t on t.id=wt."tagId" where wt."writingEntryId"=$1', [row.id])).map((r) => r.name)
  : [];
step('4-落库标签名', { entryId: row?.id, storedTagNames: stored, expected: TAG_NAME, equal: stored[0] === TAG_NAME });
evidence.bugConfirmed = stored.length === 1 && stored[0] !== TAG_NAME;

// 5) 刷新后界面展示
await page.reload({ waitUntil: 'domcontentloaded' });
await waitAppReady(page);
const card = page.locator('div.rounded-lg.border:has(h3)').filter({ hasText: CONTENT }).first();
await card.waitFor({ timeout: 20000 });
const cardText = await card.innerText();
const displayedTag = stored[0] || '';
step('5-刷新后卡片标签', {
  cardHasStoredName: cardText.includes(displayedTag),
  cardHasDisplayName: cardText.includes(TAG_NAME),
  cardText: cardText.replace(/\n/g, ' | ').slice(0, 300),
});
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: '/tmp/e2e-writing-bug-f1b-03-after-reload.png', fullPage: true });

// 6) 标签管理里显示的名字（TagConfig）
await page.getByRole('button', { name: '添加积累', exact: true }).first().click();
dlg = page.getByRole('dialog');
await dlg.getByRole('button', { name: /标签管理|^标签$/ }).first().click();
tagDlg = page.getByRole('dialog');
await tagDlg.waitFor({ state: 'visible' });
const tagDlgText = await tagDlg.innerText();
step('6-标签管理中的显示名', {
  hasDisplayName: tagDlgText.includes(TAG_NAME),
  hasStoredName: displayedTag ? tagDlgText.includes(displayedTag) : false,
});
await page.screenshot({ path: '/tmp/e2e-writing-bug-f1b-04-tagmanager.png', fullPage: true });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

evidence.logs = logs.slice(0, 30);
writeFileSync('/tmp/e2e-writing-bug-f1b.json', JSON.stringify(evidence, null, 2));

// 清理本次复现数据（仅本次 runId 内容）
if (row) await db.query('delete from "WritingEntry" where id=$1', [row.id]);
await db.query('delete from "TagConfig" where "userId"=$1 and name=$2', [userId, TAG_NAME]);
for (const t of stored) await db.query('delete from "Tag" where name=$1', [t]);

console.log('BUG CONFIRMED =', evidence.bugConfirmed);
await browser.close();
await db.end();
