/**
 * 「积累本」回归用例（数据模型 + 首页 + 列表 + 本内视图 + 复制/移动 + 删除）
 *
 * 覆盖：
 *   NT01 首页：日期 / 每日一句 / 「打开我的积累本」按钮跳转
 *   NT02 积累本列表：迁移回填的默认本与数据库一致
 *   NT03 新建积累本并落库
 *   NT04 重名拦截
 *   NT05 重命名
 *   NT06 进入本内视图（空本）
 *   NT07 本内新增积累 → 写入 NotebookEntry
 *   NT08 「所有积累」包含新条目且计数与库一致
 *   NT09 复制到其它积累本（多对多）
 *   NT10 移动到其它积累本（原本解除关联）
 *   NT11 删除空积累本
 *   NT12 删除有共享条目的积累本（提示共享保留，条目不丢）
 *   NT13 删除独占条目的积累本（提示会删 N 条，确认后条目删除）
 *   NT14 访问不存在的积累本提示
 *   NT15 移动端可用性
 *
 * 运行（仓库根目录）：
 *   node scripts/e2e/notebooks.mjs                                  # 打线上
 *   E2E_BASE=http://127.0.0.1:3104 node scripts/e2e/notebooks.mjs    # 打本地预览构建
 *   本地没有可用测试口令时：E2E_MINT_USER_ID=<广学 userId>（读 .env 的 SECRET_COOKIE_PASSWORD 自签会话）
 *
 * 注意：会以测试账号真实写入积累本与积累；用例删除自己建的本，finally 里再兜底清理。
 */
import {
  BASE, ENTRIES, COOKIE_NAME, launchBrowser, loginViaSso, attachLogging, dbConnect, dbAll, shot,
  waitAppReady, waitEntriesReady,
} from './lib.mjs';

const runId = 'r' + Date.now().toString(36);
const BOOK_A = `E2E素材本A-${runId}`;
const BOOK_A2 = `E2E素材本A改名-${runId}`;
const BOOK_B = `E2E素材本B-${runId}`;
const BOOK_C = `E2E素材本C-${runId}`;
const CONTENT = `E2E积累本条目-${runId}：Reading is to the mind what exercise is to the body.`;
const NOTE = `端到端备注-${runId}`;
const OUR_BOOKS = [BOOK_A, BOOK_A2, BOOK_B, BOOK_C];

const logs = [];
const alerts = [];
const results = [];

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
const j = (v) => JSON.stringify(v);

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
    // 失败用例可能把弹窗留在页面上，清掉避免污染后续用例
    try {
      for (let i = 0; i < 3; i++) {
        if ((await page.getByRole('dialog').count()) === 0) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    } catch {}
    results.push(rec);
    console.log(`${rec.status === 'PASS' ? 'PASS' : 'FAIL'} ${id} ${name} (${rec.durationMs}ms)`);
    if (rec.status === 'FAIL') console.log(`     ↳ ${rec.detail.replace(/\n/g, '\n       ')}`);
  }
  return rec.status === 'PASS';
}

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

// ---------------------------------------------------------------- 数据库辅助

const one = async (db, sql, params = []) => (await dbAll(db, sql, params))[0] ?? null;
const many = (db, sql, params = []) => dbAll(db, sql, params);

const bookRow = (db, userId, name) =>
  one(db, 'select id, name from "Notebook" where "userId"=$1 and name=$2', [userId, name]);

const bookEntries = (db, bookId) =>
  many(
    db,
    `select e.id, e.content from "NotebookEntry" ne join "WritingEntry" e on e.id = ne."writingEntryId" where ne."notebookId"=$1`,
    [bookId]
  );

const entryRow = (db, userId, content) =>
  one(db, 'select id, content, note from "WritingEntry" where "userId"=$1 and content=$2', [
    userId,
    content,
  ]);

const entryBookIds = async (db, entryId) => {
  const rows = await many(
    db,
    'select "notebookId" from "NotebookEntry" where "writingEntryId"=$1',
    [entryId]
  );
  return rows.map((r) => r.notebookId);
};

const waitDb = async (fn, { timeout = 15000, interval = 300 } = {}) => {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
};

// ---------------------------------------------------------------- 页面辅助

const navToBooks = async (page) => {
  await page.goto(`${BASE}/books`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitAppReady(page);
  await page.locator('h1').filter({ hasText: '我的积累本' }).waitFor({ timeout: 30000 });
};

const bookCard = (page, name) => page.locator(`[data-notebook-name="${name}"]`);

const openBookMenu = async (page, name) => {
  await page.locator(`[data-notebook-name="${name}"]`).getByTestId('notebook-menu-trigger').click();
  await page.getByRole('menuitem').first().waitFor({ state: 'visible', timeout: 15000 });
};

const main = async () => {
  const browser = await launchBrowser();
  const db = await dbConnect();

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
  page.setDefaultTimeout(20000);
  attachLogging(page, logs, 'notebooks');
  page.on('dialog', async (d) => {
    alerts.push({ type: d.type(), message: d.message() });
    await d.dismiss().catch(() => {});
  });

  // 兜底清理：只删本脚本创建的数据
  const cleanup = async () => {
    await many(db, 'delete from "Notebook" where "userId"=$1 and name = any($2::text[])', [
      userId,
      OUR_BOOKS,
    ]);
    await many(db, 'delete from "WritingEntry" where "userId"=$1 and content=$2', [
      userId,
      CONTENT,
    ]);
  };

  try {
    // ---------------------------------------------------------------- NT01 首页
    await test(db, page, 'NT01', '首页展示日期 / 每日一句 / 打开积累本按钮', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitAppReady(page);
      const body = await page.locator('body').innerText();
      ok(/年\s*\d+\s*月\s*\d+\s*日\s*星期/.test(body), '首页没有显示日期');
      ok(/“[\s\S]+”/.test(body), '首页没有显示每日一句');
      ok(await page.getByRole('heading', { name: /我的积累本/ }).first().isVisible(), '首页没有「我的积累本」区块');

      const entryCount = Number(
        (
          await one(db, 'select count(*)::int c from "WritingEntry" where "userId"=$1', [userId])
        ).c
      );
      ok(body.includes('积累条目'), '首页没有统计条');

      await page.getByRole('button', { name: /打开我的积累本/ }).click();
      await page.waitForURL(/\/books$/, { timeout: 20000 });
      console.log(`     （首页统计：该账号共 ${entryCount} 条积累）`);
    });

    // ---------------------------------------------------------------- NT02 列表
    await test(db, page, 'NT02', '积累本列表显示迁移回填的默认本', async () => {
      await navToBooks(page);
      const defaultBook = await bookRow(db, userId, '我的积累本');
      ok(defaultBook, '迁移后应存在「我的积累本」');
      const card = bookCard(page, '我的积累本');
      ok(await card.count(), '列表里没有「我的积累本」卡片');
      const dbCount = (await bookEntries(db, defaultBook.id)).length;
      const text = await card.first().innerText();
      ok(text.includes(`${dbCount} 条积累`), `默认本条数应显示 ${dbCount}，实际「${text}」`);
      ok(await page.getByTestId('all-entries-card').isVisible(), '缺少「所有积累」入口');
    });

    // ---------------------------------------------------------------- NT03 新建
    await test(db, page, 'NT03', '新建积累本并落库', async () => {
      await navToBooks(page);
      await page.getByRole('button', { name: /新建积累本|^新建$/ }).first().click();
      await page.getByTestId('notebook-name-input').fill(BOOK_A);
      await page.getByTestId('notebook-submit').click();
      await bookCard(page, BOOK_A).waitFor({ state: 'visible', timeout: 20000 });
      ok(await bookRow(db, userId, BOOK_A), '数据库里没有新建的积累本');
    });

    // ---------------------------------------------------------------- NT04 重名
    await test(db, page, 'NT04', '同名积累本被拒绝', async () => {
      await page.getByRole('button', { name: /新建积累本|^新建$/ }).first().click();
      await page.getByTestId('notebook-name-input').fill(BOOK_A);
      await page.getByTestId('notebook-submit').click();
      await page.getByText('已存在同名积累本').waitFor({ state: 'visible', timeout: 15000 });
      const rows = await many(db, 'select id from "Notebook" where "userId"=$1 and name=$2', [
        userId,
        BOOK_A,
      ]);
      ok(rows.length === 1, `同名积累本被插入 ${rows.length} 条`);
      await page.keyboard.press('Escape');
    });

    // ---------------------------------------------------------------- NT05 改名
    await test(db, page, 'NT05', '重命名积累本', async () => {
      await openBookMenu(page, BOOK_A);
      await page.getByRole('menuitem', { name: /重命名/ }).click();
      await page.getByTestId('notebook-name-input').fill(BOOK_A2);
      await page.getByTestId('notebook-submit').click();
      await bookCard(page, BOOK_A2).waitFor({ state: 'visible', timeout: 20000 });
      ok(await bookRow(db, userId, BOOK_A2), '数据库里没有改名后的积累本');
      ok(!(await bookRow(db, userId, BOOK_A)), '旧名字的积累本仍然存在');
    });

    // ---------------------------------------------------------------- NT06 进入本内
    await test(db, page, 'NT06', '进入积累本内视图（空本）', async () => {
      const book = await bookRow(db, userId, BOOK_A2);
      await page.locator(`[data-notebook-name="${BOOK_A2}"]`).click();
      await page.waitForURL(new RegExp(`/books/${book.id}$`), { timeout: 20000 });
      await page.locator('h1').filter({ hasText: BOOK_A2 }).waitFor({ timeout: 20000 });
      const body = await page.locator('body').innerText();
      ok(body.includes('共 0 个积累'), `空本应显示 0 条，实际：${body.slice(0, 120)}`);
      ok(await page.getByRole('link', { name: /返回我的积累本/ }).count(), '缺少返回积累本列表的链接');
    });

    // ---------------------------------------------------------------- NT07 本内新增
    await test(db, page, 'NT07', '本内新增积累并写入 NotebookEntry', async () => {
      const book = await bookRow(db, userId, BOOK_A2);
      await page.getByRole('button', { name: '添加积累', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      await dialog.locator('textarea').first().fill(CONTENT);
      await dialog.locator('textarea').nth(1).fill(NOTE);
      await dialog.getByRole('button', { name: '添加', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 20000 });

      await waitDb(async () => {
        const e = await entryRow(db, userId, CONTENT);
        return e && (await entryBookIds(db, e.id)).includes(book.id);
      }).then((okd) => ok(okd, '新条目没有关联到当前积累本'));

      const entry = await entryRow(db, userId, CONTENT);
      ok(entry && entry.note === NOTE, `备注未落库：${j(entry)}`);
      const body = await page.locator('body').innerText();
      ok(body.includes('共 1 个积累'), `本内应显示 1 条，实际：${body.slice(0, 120)}`);
    });

    // ---------------------------------------------------------------- NT08 所有积累
    await test(db, page, 'NT08', '「所有积累」包含新条目且计数与库一致', async () => {
      await page.goto(ENTRIES, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitEntriesReady(page);
      const total = Number(
        (await one(db, 'select count(*)::int c from "WritingEntry" where "userId"=$1', [userId])).c
      );
      const body = await page.locator('body').innerText();
      ok(body.includes(CONTENT.slice(0, 20)), '所有积累里看不到新条目');
      const m = body.match(/共\s*(\d+)\s*个积累/);
      ok(m && Number(m[1]) === total, `所有积累计数应为 ${total}，实际 ${m ? m[1] : 'N/A'}`);
    });

    // ---------------------------------------------------------------- NT09 复制
    await test(db, page, 'NT09', '复制条目到其它积累本（多对多）', async () => {
      // 先建目标本
      await navToBooks(page);
      await page.getByRole('button', { name: /新建积累本|^新建$/ }).first().click();
      await page.getByTestId('notebook-name-input').fill(BOOK_B);
      await page.getByTestId('notebook-submit').click();
      await bookCard(page, BOOK_B).waitFor({ state: 'visible', timeout: 20000 });

      const bookA = await bookRow(db, userId, BOOK_A2);
      const bookB = await bookRow(db, userId, BOOK_B);

      await page.goto(`${BASE}/books/${bookA.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('h1').filter({ hasText: BOOK_A2 }).waitFor({ timeout: 20000 });
      // 选中本内唯一一条（点卡片正文）
      await page.getByText(CONTENT.slice(0, 12)).first().click();
      await page.getByRole('button', { name: '批量操作' }).first().click();
      await page.getByRole('button', { name: /复制到其它积累本/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(BOOK_B).click();
      await dialog.getByRole('button', { name: '复制', exact: true }).click();
      await waitDb(async () => {
        const entry = await entryRow(db, userId, CONTENT);
        const ids = await entryBookIds(db, entry.id);
        return ids.includes(bookA.id) && ids.includes(bookB.id);
      }).then((okd) => ok(okd, '复制后条目应同时属于两个积累本'));
      ok(
        alerts.some((a) => a.message.includes('已复制')),
        `没有看到「已复制」提示：${j(alerts.slice(-3))}`
      );
    });

    // ---------------------------------------------------------------- NT10 移动
    await test(db, page, 'NT10', '移动到其它积累本（原本解除关联）', async () => {
      const bookA = await bookRow(db, userId, BOOK_A2);
      const bookB = await bookRow(db, userId, BOOK_B);
      await page.goto(`${BASE}/books/${bookB.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('h1').filter({ hasText: BOOK_B }).waitFor({ timeout: 20000 });

      // 选中本内唯一一条（点卡片正文即可选中，卡片自身带 Checkbox）
      await page.getByText(CONTENT.slice(0, 12)).first().click();
      await page.getByRole('button', { name: '批量操作' }).first().click();
      await page.getByRole('button', { name: /移动到其它积累本/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(BOOK_A2).click();
      await dialog.getByRole('button', { name: '移动', exact: true }).click();
      await waitDb(async () => {
        const entry = await entryRow(db, userId, CONTENT);
        const ids = await entryBookIds(db, entry.id);
        return ids.includes(bookA.id) && !ids.includes(bookB.id);
      }).then((okd) => ok(okd, '移动后条目应只属于目标积累本'));
    });

    // ---------------------------------------------------------------- NT11 删除空本
    await test(db, page, 'NT11', '删除空积累本', async () => {
      await navToBooks(page);
      await openBookMenu(page, BOOK_B);
      await page.getByRole('menuitem', { name: /删除/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('该积累本是空的').waitFor({ state: 'visible', timeout: 15000 });
      await page.getByTestId('notebook-delete-confirm').click();
      await waitDb(async () => !(await bookRow(db, userId, BOOK_B))).then((okd) =>
        ok(okd, '空积累本没有被删除')
      );
      ok(await bookCard(page, BOOK_B).count() === 0, '列表里仍显示已删除的积累本');
    });

    // ---------------------------------------------------------------- NT12 删共享本
    await test(db, page, 'NT12', '删除有共享条目的积累本：提示共享保留、条目仍在', async () => {
      await navToBooks(page);
      await page.getByRole('button', { name: /新建积累本|^新建$/ }).first().click();
      await page.getByTestId('notebook-name-input').fill(BOOK_C);
      await page.getByTestId('notebook-submit').click();
      await bookCard(page, BOOK_C).waitFor({ state: 'visible', timeout: 20000 });
      const bookC = await bookRow(db, userId, BOOK_C);
      const entry = await entryRow(db, userId, CONTENT);

      // 直接把 C 与条目关联（等价于在 C 内复制，避免重复 UI 流程）
      await many(
        db,
        'insert into "NotebookEntry" ("notebookId","writingEntryId","createdAt") values ($1,$2,now()) on conflict do nothing',
        [bookC.id, entry.id]
      );

      await navToBooks(page);
      await openBookMenu(page, BOOK_C);
      await page.getByRole('menuitem', { name: /删除/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(/条积累同时存在于其它积累本/).waitFor({ state: 'visible', timeout: 15000 });
      const text = await dialog.innerText();
      ok(text.includes('1'), `应提示 1 条共享，实际：${text.replace(/\n/g, ' ')}`);
      await page.getByTestId('notebook-delete-confirm').click();

      await waitDb(async () => !(await bookRow(db, userId, BOOK_C))).then((okd) =>
        ok(okd, '积累本 C 没有被删除')
      );
      ok(await entryRow(db, userId, CONTENT), '共享条目不应被删除');
    });

    // ---------------------------------------------------------------- NT13 删独占本
    await test(db, page, 'NT13', '删除独占条目的积累本：提示条数并删除条目', async () => {
      await navToBooks(page);
      await openBookMenu(page, BOOK_A2);
      await page.getByRole('menuitem', { name: /删除/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(/仅属于该本的/).waitFor({ state: 'visible', timeout: 15000 });
      const text = await dialog.innerText();
      ok(/仅属于该本的\s*1\s*条积累/.test(text.replace(/\n/g, ' ')), `提示文案不符：${text.replace(/\n/g, ' ')}`);
      await page.getByTestId('notebook-delete-confirm').click();
      await waitDb(async () => !(await entryRow(db, userId, CONTENT))).then((okd) =>
        ok(okd, '独占条目没有被删除')
      );
      ok(!(await bookRow(db, userId, BOOK_A2)), '积累本没有被删除');
    });

    // ---------------------------------------------------------------- NT14 不存在
    await test(db, page, 'NT14', '访问不存在的积累本有明确提示', async () => {
      await page.goto(`${BASE}/books/99999999`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByText('积累本不存在或无权访问').waitFor({ state: 'visible', timeout: 20000 });
    });

    // ---------------------------------------------------------------- NT15 移动端
    await test(db, page, 'NT15', '移动端：首页与积累本列表可用', async () => {
      const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
      await mCtx.addCookies(
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
      const p = await mCtx.newPage();
      p.setDefaultTimeout(20000);
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitAppReady(p);
      ok(await p.getByRole('button', { name: /打开我的积累本/ }).isVisible(), '移动端首页缺少主按钮');
      await p.getByRole('button', { name: /打开我的积累本/ }).click();
      await p.waitForURL(/\/books$/, { timeout: 20000 });
      ok(await p.getByRole('button', { name: /新建积累本|^新建$/ }).first().isVisible(), '移动端缺少新建按钮');
      await mCtx.close();
    });
  } finally {
    await cleanup().catch((e) => console.error('清理测试数据失败:', e.message));
  }

  console.log('\n日志（console/pageerror/requestfailed）:', logs.length ? '' : '无');
  for (const l of logs.slice(0, 15)) console.log(' -', l.kind, l.text);
  console.log('弹窗提示:', alerts.length ? j(alerts.slice(-6)) : '无');

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
