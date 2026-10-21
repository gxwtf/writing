/**
 * 「设置 → 标签管理」回归用例
 *
 * 覆盖：首页导航 → 设置页、设置页打开标签管理弹窗、新建标签、改名 / 改色、重名不落库、
 * 删除标签，以及首页「添加积累 → 标签管理」弹窗未被破坏。
 *
 * 运行（仓库根目录）：
 *   node scripts/e2e/settings-tags.mjs                          # 打线上 https://writing.gxwtf.cn
 *   E2E_BASE=http://127.0.0.1:3104 node scripts/e2e/settings-tags.mjs   # 打本地预览构建
 *
 * 登录方式：
 *   1) 默认走广学账号 SSO（scripts/e2e/creds.json，或环境变量 GX_IDENT / GX_PASSWORD）；
 *   2) 本地预览没有可用测试口令时，可临时用 E2E_MINT_USER_ID=<广学 userId> 直接签一个会话 Cookie
 *      （读取 .env 的 SECRET_COOKIE_PASSWORD，仅限服务器本机自测；线上回归请用方式 1）。
 *
 * 注意：会以测试账号真实写入 TagConfig；用例结束（含失败）只删除本脚本自己建的标签。
 */
import {
  BASE, COOKIE_NAME, launchBrowser, loginViaSso, attachLogging, dbConnect, dbAll, shot,
} from './lib.mjs';

const runId = 'r' + Date.now().toString(36);
const TAG_NEW = `E2E设置页标签-${runId}`;
const TAG_RENAMED = `E2E设置页改名-${runId}`;
const OUR_TAGS = [TAG_NEW, TAG_RENAMED];

const logs = [];
const results = [];

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function test(db, page, id, name, fn) {
  const started = Date.now();
  const rec = { id, name, status: 'PASS', detail: '', screenshot: null, durationMs: 0 };
  try {
    await fn(rec);
  } catch (e) {
    rec.status = 'FAIL';
    rec.detail = String(e?.message || e).slice(0, 1500);
  } finally {
    rec.durationMs = Date.now() - started;
    rec.screenshot = await shot(page, id);
    results.push(rec);
    console.log(`${rec.status === 'PASS' ? 'PASS' : 'FAIL'} ${id} ${name} (${rec.durationMs}ms)`);
    if (rec.status === 'FAIL') console.log(`     ↳ ${rec.detail.replace(/\n/g, '\n       ')}`);
  }
  return rec.status === 'PASS';
}

/** 本机自测用：用 .env 里的 SECRET_COOKIE_PASSWORD 直接签一个 iron-session Cookie */
async function mintSessionCookie(userId, userName) {
  const secret = process.env.SECRET_COOKIE_PASSWORD;
  if (!secret) throw new Error('未设置 SECRET_COOKIE_PASSWORD，无法签发自测会话');
  const { sealData } = await import('iron-session');
  const value = await sealData(
    { isLoggedIn: true, userId, userName, admin: 0, email: '', realName: '' },
    { password: secret }
  );
  return { name: COOKIE_NAME, value, host: new URL(BASE).hostname };
}

const cfgRows = async (db, userId, name) =>
  dbAll(db, 'select name,"colorId" from "TagConfig" where "userId"=$1 and name=$2', [userId, name]);

/** 轮询数据库直到条件满足（服务端 action 落库不是瞬时的） */
const waitDb = async (fn, { timeout = 15000, interval = 300 } = {}) => {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
};

const waitHome = (page) =>
  page.waitForFunction(() => (document.body?.innerText || '').includes('我的作文积累本'), {
    timeout: 45000,
  });

const main = async () => {
  const browser = await launchBrowser();
  const db = await dbConnect();

  // 只清理本脚本创建的标签（正常流程用例 6 已删除，这里是失败兜底）
  const cleanup = async (userId) => {
    await dbAll(
      db,
      'delete from "TagConfig" where "userId"=$1 and name = any($2::text[])',
      [userId, OUR_TAGS]
    );
    await dbAll(db, 'delete from "Tag" where name = any($1::text[])', [OUR_TAGS]);
  };

  let userId;
  let cookies;
  const mintUserId = process.env.E2E_MINT_USER_ID ? Number(process.env.E2E_MINT_USER_ID) : null;
  if (mintUserId) {
    userId = mintUserId;
    cookies = [await mintSessionCookie(mintUserId, process.env.E2E_MINT_USER_NAME || '小广_2')];
    console.log('使用自签会话 Cookie，userId =', userId);
  } else {
    ({ userId, cookies } = await loginViaSso());
  }

  const target = new URL(BASE);
  console.log('BASE =', BASE, 'userId =', userId);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await ctx.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: target.hostname,
      path: '/',
      httpOnly: true,
      secure: target.protocol === 'https:',
      sameSite: 'Lax',
    }))
  );

  const page = await ctx.newPage();
  attachLogging(page, logs, 'settings-tags');

  /** 标签管理弹窗（设置页弹出的 TagEditModal） */
  const tagDialog = () =>
    page.getByRole('dialog').filter({
      has: page.locator('[data-slot="dialog-title"]').filter({ hasText: '标签管理' }),
    });

  try {
    // 用例 1：首页导航里的「设置」入口
    await test(db, page, 'ST01', '首页导航含「设置」并进入设置中心', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitHome(page);
      const settingsLink = page.getByRole('link', { name: /设置/ }).first();
      ok((await settingsLink.count()) > 0, '导航里找不到「设置」入口');
      await settingsLink.click();
      await page.waitForURL(/\/settings$/, { timeout: 15000 });
      const h1 = await page.locator('h1').innerText();
      ok(h1.includes('设置'), `设置页标题异常：${h1}`);
      ok(
        (await page.getByRole('button', { name: /标签管理/ }).count()) > 0,
        '设置页里没有「标签管理」入口'
      );
    });

    // 用例 2：设置页 → 标签管理弹窗
    await test(db, page, 'ST02', '设置页打开标签管理弹窗', async () => {
      await page.getByRole('button', { name: /标签管理/ }).first().click();
      const dialog = tagDialog();
      await dialog.waitFor({ state: 'visible', timeout: 15000 });
      ok(await dialog.getByPlaceholder('新标签名称').isVisible(), '弹窗里没有「新标签名称」输入框');
      ok((await dialog.getByRole('button', { name: '完成' }).count()) > 0, '弹窗里没有「完成」按钮');
    });

    // 用例 3：新建标签
    await test(db, page, 'ST03', '新建标签并落库', async () => {
      const dialog = tagDialog();
      await dialog.getByPlaceholder('新标签名称').fill(TAG_NEW);
      await dialog.getByRole('button', { name: /添加/ }).first().click();

      await dialog.getByText(TAG_NEW, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
      const rows = await cfgRows(db, userId, TAG_NEW);
      ok(rows.length === 1, `TagConfig 应有 1 条，实际 ${rows.length}`);
      ok(rows[0].colorId === 'blue', `新标签默认颜色应为 blue，实际 ${rows[0].colorId}`);
    });

    // 用例 4：改名 + 改色（沿用 TagEditModal 的编辑态 + 颜色弹窗）
    await test(db, page, 'ST04', '重命名 / 改色', async () => {
      const dialog = tagDialog();
      await dialog.getByRole('button', { name: `编辑标签 ${TAG_NEW}` }).click();

      // 编辑态的标签名输入框（带 aria-label="标签名称"）
      await dialog.getByLabel('标签名称').fill(TAG_RENAMED);

      // 编辑态里点色点 → 颜色选择弹窗 → 选紫色 → 确认
      await dialog.locator('button[title="更改颜色"]').first().click();
      const colorDialog = page.getByRole('dialog').filter({
        has: page.locator('[data-slot="dialog-title"]').filter({ hasText: '选择颜色' }),
      });
      await colorDialog.waitFor({ state: 'visible', timeout: 15000 });
      await colorDialog.getByRole('button', { name: /紫色/ }).first().click();
      await colorDialog.getByRole('button', { name: '确认' }).click();
      await colorDialog.waitFor({ state: 'hidden', timeout: 15000 });

      await dialog.getByRole('button', { name: '保存' }).click();
      await dialog.getByText(TAG_RENAMED, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });

      const renamed = await cfgRows(db, userId, TAG_RENAMED);
      ok(renamed.length === 1, `改名后 TagConfig 应有 1 条，实际 ${renamed.length}`);
      ok(renamed[0].colorId === 'purple', `颜色应为 purple，实际 ${renamed[0].colorId}`);
      ok((await cfgRows(db, userId, TAG_NEW)).length === 0, '旧标签名仍留在库里');
    });

    // 用例 5：重名不落库
    await test(db, page, 'ST05', '重名标签不会重复落库', async () => {
      const dialog = tagDialog();
      await dialog.getByPlaceholder('新标签名称').fill(TAG_RENAMED);
      await dialog.getByRole('button', { name: /添加/ }).first().click();
      await page.waitForTimeout(800);
      const rows = await cfgRows(db, userId, TAG_RENAMED);
      ok(rows.length === 1, `重名标签被写入了 ${rows.length} 条`);
      ok(
        (await dialog.getByText(TAG_RENAMED, { exact: true }).count()) === 1,
        '弹窗里出现了重复的标签项'
      );
      await dialog.getByPlaceholder('新标签名称').fill('');
    });

    // 用例 6：删除标签
    await test(db, page, 'ST06', '删除标签并从库中清除', async () => {
      const dialog = tagDialog();
      await dialog.getByRole('button', { name: `删除标签 ${TAG_RENAMED}` }).click();

      const confirm = page.getByRole('dialog').filter({
        has: page.locator('[data-slot="dialog-title"]').filter({ hasText: '确认删除' }),
      });
      await confirm.waitFor({ state: 'visible', timeout: 15000 });
      ok((await confirm.innerText()).includes(TAG_RENAMED), '删除确认弹窗没显示标签名');
      await confirm.getByRole('button', { name: '删除' }).click();
      await confirm.waitFor({ state: 'hidden', timeout: 20000 });

      // 弹窗里的列表跟着 state 更新，库里的删除由 Server Action 异步完成，这里轮询等它落地
      ok(
        await waitDb(async () => (await cfgRows(db, userId, TAG_RENAMED)).length === 0),
        'TagConfig 未被删除'
      );
      await dialog
        .getByText(TAG_RENAMED, { exact: true })
        .waitFor({ state: 'detached', timeout: 20000 });
    });

    // 用例 7：首页标签管理弹窗仍可用（设置页改动没有破坏原有入口）
    await test(db, page, 'ST07', '首页「添加积累 → 标签管理」弹窗仍可用', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitHome(page);
      await page.getByRole('button', { name: /添加积累|^添加$/ }).first().click();
      const addDialog = page.getByRole('dialog');
      await addDialog.first().waitFor({ state: 'visible' });
      await addDialog.first().getByRole('button', { name: /标签管理|^标签$/ }).first().click();

      // 外层弹窗会被 aria-hidden，当前可见的应该是标签管理弹窗
      const dialog = tagDialog();
      await dialog.first().waitFor({ state: 'visible', timeout: 15000 });
      ok(
        await dialog.first().getByPlaceholder('新标签名称').isVisible(),
        '标签管理弹窗没打开'
      );
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    });
  } finally {
    await cleanup(userId).catch((e) => console.error('清理测试标签失败:', e.message));
  }

  console.log('\n日志（console/pageerror/requestfailed）:', logs.length ? '' : '无');
  for (const l of logs.slice(0, 20)) console.log(' -', l.kind, l.text);

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  await browser.close();
  await db.end();
  if (failed.length) process.exitCode = 1;
};

main().catch((e) => {
  console.error('运行失败：', e);
  process.exit(1);
});
