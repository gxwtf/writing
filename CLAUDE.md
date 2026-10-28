# 项目开发与测试规范（作文积累本）

## 项目定位

「作文积累本」是从「广学英语」拆分出来的**独立项目**，负责作文积累的收藏、整理、检索、标签、AI 找词与 PDF 导出。

- 生产地址：<https://writing.gxwtf.cn>
- 广学英语（english.gxwtf.cn）现在只保留「单词本」与「题目列表」；其 `/writing` 路由会 308 跳转到本项目。
- 开发文档：<https://dev.gxwtf.cn/#/writing/>（代码变更后请同步更新 `~/gxwtf_dev` 与 `~/gxwtf_docs`）。

## 技术栈

- React 19 + Next.js（App Router）+ TypeScript
- Tailwind CSS 4 + shadcn/ui + lucide-react
- Prisma 7 + PostgreSQL（`@prisma/adapter-pg`）
- 广学账号 SSO + iron-session

## 核心规范

- 使用 **App Router**，不是 Pages Router。
- 尽量使用 **Server Actions**，避免新增传统 REST API。
- 包管理使用 **pnpm**，禁止 npm。
- 构建脚本固定为 **`next build --webpack`**，不要改回默认 Turbopack。
- 数据库仅允许操作 localhost；生产数据库为服务器本机 `gxwtf_writing`。
- **AI 功能**：统一走 `POST /api/ai/learn`（SSE 流式，Route Handler）；大模型来源优先级为
  「显式传参 > 用户 BYOK（`User.aiSettings`）> 系统默认 `LLM_CONFIGS`」。提示词集中在
  `src/lib/ai-learn-prompts.ts` / `ai-word-prompts.ts`，改动后请同步两处文档。

### 严禁删除数据

除非明确要求，否则不得删除或大规模修改任何数据。高危操作包括：删库、删表/列、清空表、批量删除记录、
`prisma migrate reset`、`prisma db push`、可能导致数据丢失的迁移。执行前必须说明命令、原因、影响范围与风险，
并等待人工确认。

### 必须测试

代码修改后不得直接结束任务：

1. `pnpm typecheck` 与 `pnpm build` 必须通过；
2. 涉及页面的改动，运行 `scripts/e2e/` 下的 Playwright 回归（服务器上用 `/usr/bin/microsoft-edge`，
   **不要用 `chromium-browser`**）；
3. 回归脚本使用测试账号（`scripts/e2e/creds.json`，当前为 `爸儿爷孙天团`，普通用户），**不要用开发者本人账号**；脚本会真实写入数据且不自动清理，跑完记得清理该账号下的测试数据；
4. 若改动了「新增/编辑/删除/批量标签」等核心流程，务必跑一遍完整回归。

### PDF 字体

`public/fonts/` 下的 `simsun.ttf` / `times.ttf` / `timesbd.ttf` 是部署资产（不入库），
缺失会导致 PDF 导出失败；部署/重装时从 `~/gxwtf_english/public/fonts/` 拷贝。

## 部署

```bash
cd ~/gxwtf_writing
git pull
pnpm install                       # 依赖变化时
pnpm exec prisma migrate deploy    # 有迁移时
pnpm build                         # 必须成功
sudo systemctl restart gxwriting.service
```

systemd 服务名：`gxwriting.service`；端口：`3004`。

## 未来规划

- 语文作文积累：`WritingEntry.subject` 已预留（当前固定 `english`），新增 `chinese` 时无需改表结构。
