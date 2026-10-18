/**
 * 快速验证新版 helper：openAddModal / uiCreateTags / addEntry / 标签管理自动关闭
 */
import {
  BASE, launchBrowser, newContextWithCookies, loginViaSso, attachLogging,
  waitAppReady, dbConnect, dbOne, dbAll,
} from './lib.mjs';

const logs = [];
const browser = await launchBrowser();
const db = await dbConnect();
const { userId, cookies } = await loginViaSso();
console.log('userId', userId);
const ctx = await newContextWithCookies(browser, cookies);
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
attachLogging(page, logs, 'smoke');

const runId = 'sm' + Date.now().toString(36);
const TAG = `Smoke标签-${runId}`;
const CONTENT = `Smoke E2E ${runId} 内容`;

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitAppReady(page);
console.log('ready; heading =', await page.locator('h1').innerText());

// 1) 打开添加弹窗（精确按钮）
await page.getByRole('button', { name: '添加积累', exact: true }).first().click();
let dlg = page.getByRole('dialog');
await dlg.waitFor({ state: 'visible' });
console.log('add dialog title =', await dlg.locator('[data-slot="dialog-title"]').innerText());

// 2) 进标签管理并新增标签
await dlg.getByRole('button', { name: /标签管理|^标签$/ }).first().click();
let tagDlg = page.getByRole('dialog');
await tagDlg.waitFor({ state: 'visible' });
console.log('tag dialog title =', await tagDlg.locator('[data-slot="dialog-title"]').innerText());
await tagDlg.locator('input[placeholder="新标签名称"]').fill(TAG);
await tagDlg.getByRole('button', { name: /^添加$/ }).click();
await page.waitForTimeout(800);
const cfg = await dbAll(db, 'select name,"colorId" from "TagConfig" where "userId"=$1 and name=$2', [userId, TAG]);
console.log('tagconfig after add =', JSON.stringify(cfg));
console.log('dialog count after add =', await page.getByRole('dialog').count());
console.log('dialog title now =', await page.getByRole('dialog').locator('[data-slot="dialog-title"]').allInnerTexts().catch(() => []));

// 3) 填写内容 + 选标签 + 提交
dlg = page.getByRole('dialog');await dlg.locator('textarea').nth(0).fill(CONTENT);
await dlg.getByText(TAG, { exact: true }).first().click();
const submit = dlg.getByRole('button', { name: '添加', exact: true });
await page.waitForTimeout(300);
console.log('submit disabled =', await submit.isDisabled());
await submit.click();
await dlg.waitFor({ state: 'hidden', timeout: 20000 });
await page.waitForTimeout(800);
const row = await dbOne(db, 'select id,content from "WritingEntry" where "userId"=$1 and content=$2', [userId, CONTENT]);
console.log('entry row =', JSON.stringify(row));
if (row) {
  const tags = await dbAll(db, 'select t.name from "WritingEntryTag" wt join "Tag" t on t.id=wt."tagId" where wt."writingEntryId"=$1', [row.id]);
  console.log('entry tags =', JSON.stringify(tags));
}
console.log('card visible =', await page.locator('div.rounded-lg.border:has(h3)').filter({ hasText: CONTENT }).count());
console.log('--- logs ---');
for (const l of logs) console.log(l.kind, l.text.slice(0, 200));

// 清理本次 smoke 数据
if (row) await db.query('delete from "WritingEntry" where id=$1', [row.id]);
await db.query('delete from "TagConfig" where "userId"=$1 and name=$2', [userId, TAG]);
await db.query('delete from "Tag" where name=$1', [TAG]);

await browser.close();
await db.end();
