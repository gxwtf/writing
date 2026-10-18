/**
 * 探索脚本：验证 SSO 登录、首屏、关键选择器（不写入数据）
 */
import {
  BASE, launchBrowser, newContextWithCookies, loginViaSso, attachLogging,
  waitAppReady, readCounts, cards, shot, dbConnect, dbAll,
} from './lib.mjs';

const logs = [];
const browser = await launchBrowser();
const db = await dbConnect();

const baseline = {
  entries: Number((await dbAll(db, 'select count(*) c from "WritingEntry"'))[0].c),
  users: Number((await dbAll(db, 'select count(*) c from "User"'))[0].c),
};
console.log('baseline', baseline);

const { userId, cookies } = await loginViaSso();
console.log('sso userId=', userId, 'cookies=', cookies.map((c) => c.name));

const ctx = await newContextWithCookies(browser, cookies);
const page = await ctx.newPage();
attachLogging(page, logs, 'main');

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitAppReady(page);
console.log('URL:', page.url());
console.log('H1:', await page.locator('h1').allInnerTexts());
console.log('counts:', await readCounts(page));
console.log('cards:', (await cards(page).count()));
await shot(page, 'explore-01-home');

// 打开添加弹窗，检查字段
await page.getByRole('button', { name: /添加积累|^添加$/ }).first().click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible' });
console.log('dialog title:', await dialog.locator('[data-slot="dialog-title"]').innerText());
console.log('dialog textareas:', await dialog.locator('textarea').count());
console.log('dialog buttons:', await dialog.getByRole('button').allInnerTexts());
console.log('placeholder list:', await dialog.locator('[placeholder]').evaluateAll((els) => els.map((e) => e.getAttribute('placeholder'))));
await shot(page, 'explore-02-add-modal');
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'hidden' });

// 标签管理弹窗
await page.getByRole('button', { name: /添加积累|^添加$/ }).first().click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByRole('button', { name: /标签管理|^标签$/ }).first().click();
await page.waitForTimeout(500);
const dialogs = page.getByRole('dialog');
console.log('dialogs open:', await dialogs.count());
console.log('last dialog title:', await dialogs.last().locator('[data-slot="dialog-title"]').innerText());
console.log('tag mgmt inputs:', await dialogs.last().locator('input').count());
console.log('tag mgmt placeholders:', await dialogs.last().locator('input').evaluateAll((els) => els.map((e) => e.getAttribute('placeholder'))));
await shot(page, 'explore-03-tag-modal');

// 数据库里测试账号信息
const u = await dbAll(db, 'select id,"userId","userName" from "User" where "userId"=$1', [userId]);
console.log('db user row:', u);
const own = await dbAll(db, 'select count(*) c from "WritingEntry" where "userId"=$1', [userId]);
console.log('own entries:', own[0].c);

console.log('--- logs ---');
for (const l of logs) console.log(l.kind, l.text);

await browser.close();
await db.end();
