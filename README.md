# 作文积累本

广学五题坊（广坊）旗下的**独立作文积累本**，从「广学英语」项目中拆分而来。

- 生产地址：<https://writing.gxwtf.cn>
- 开发文档：<https://dev.gxwtf.cn/#/writing/>
- 广学账号 SSO：<https://account.gxwtf.cn>

## 功能

- 作文积累的增删改查（内容 + 备注 + 标签）
- 标签管理（颜色、描述）与按标签筛选（且 / 或）
- 搜索、首字母排序、批量选择（全选 / 区间选择）
- 批量设置标签、批量删除
- AI 找词：从选中的作文中提取高级替换词 / 高考核心词 / 写作高级表达 / 外刊词汇（结果可一键复制）
- PDF 导出（A4 双栏，可打印）

> 规划：未来将支持语文作文积累（`WritingEntry.subject` 字段已预留，目前固定为 `english`）。

## 技术栈

- React 19 + Next.js 16（App Router）+ TypeScript
- Tailwind CSS 4 + shadcn/ui + lucide-react
- Prisma 7 + PostgreSQL（`@prisma/adapter-pg`）
- 认证：广学账号 SSO + iron-session（Cookie `gxwtf_iron_auth`）
- AI：OpenAI 兼容接口（`LLM_CONFIGS`）
- PDF：jsPDF（矢量排版，字体来自 `public/fonts/`）

## 本地开发

```bash
pnpm install

# 配置环境变量
cp .env.example .env

# 初始化数据库（仅允许 localhost）
pnpm exec prisma migrate dev
pnpm exec prisma generate

# 启动开发服务器（默认 3004）
pnpm dev
```

访问 <http://localhost:3004>。

### PDF 字体

PDF 导出依赖 `public/fonts/` 下的三个字体文件（**不纳入 git**）：

```
public/fonts/simsun.ttf
public/fonts/times.ttf
public/fonts/timesbd.ttf
```

部署时从服务器上已有的 `~/gxwtf_english/public/fonts/` 拷贝即可。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `GXACCOUNT_URL` | 是 | 广学账号 SSO 地址 |
| `SECRET_COOKIE_PASSWORD` | 是 | iron-session 密码，≥32 字符 |
| `SECRET_API_KEY` | 否 | 服务间 API 认证密钥（`/api/writing-entries` 使用） |
| `LLM_CONFIGS` | 是 | AI 模型配置（JSON 数组） |

## 生产部署

服务器 systemd 服务名：`gxwriting.service`（端口 `3004`，Nginx 反向代理 + HTTPS）。

```bash
cd ~/gxwtf_writing
git pull
pnpm install
pnpm exec prisma migrate deploy
pnpm build
sudo /usr/local/sbin/gxwtf-systemctl restart gxwriting.service
```

> 构建脚本固定为 `next build --webpack`，请勿改回默认的 Turbopack。

## 图标、启动图与添加到主屏幕（PWA）

站点图标是 lucide **`notebook-pen`**（笔记本 + 笔）：与广坊主站 React 首页「作文积累本」
子系统卡片同款图形，配色取本站品牌色（浅实验红底 + 实验红图形）。

全部图标 / 启动图由脚本生成，**不要手改 PNG**，改完脚本重新生成即可：

```bash
node scripts/generate-icons.mjs                  # 默认 light 配色（当前线上样式）
node scripts/generate-icons.mjs --variant=brand  # 实验红实底 + 白笔
node scripts/generate-icons.mjs --variant=indigo # 主站卡片的靛蓝→紫渐变
node scripts/generate-icons.mjs --out=/tmp/preview  # 只预览，不覆盖 public/
```

产物：

| 文件 | 用途 |
| --- | --- |
| `public/icon.svg` | SVG 母版 |
| `public/icon-192.png` / `icon-512.png` | manifest 普通图标（`purpose: any`） |
| `public/icon-maskable-512.png` | Android 自适应图标（`purpose: maskable`，图形收进安全区） |
| `public/apple-touch-icon.png` | iOS 主屏图标 180×180 |
| `public/favicon.ico` | 浏览器标签页（16 / 32 / 48，笔画加粗） |
| `public/splash/apple-splash-*.png` | iOS 启动图（13 种尺寸） |

PWA 相关：

- `public/manifest.json`：`作文积累本`、`standalone`、`theme_color #a31f24`
- `public/sw.js`：**只缓存静态资源**（`/_next/static` cache-first，图片/字体 stale-while-revalidate）；
  页面与 Server Action 一律走网络，避免把登录态页面或过期作文写进缓存
- `src/components/WebAppManager.tsx`：生产环境注册 SW；iOS Safari 弹「添加到主屏幕」操作提示，
  Chromium 移动端接管 `beforeinstallprompt` 提供「安装」按钮（桌面端不显示，避免干扰 e2e）

> `public/favicon.ico` 是唯一 favicon 来源；`src/app/favicon.ico` 已移除，
> 由 `layout.tsx` 的 `metadata.icons` 统一声明，请勿再加回。

## 数据来源

首次上线时，作文数据从广学英语数据库（`gxwtf_english`）的
`WritingEntry` / `WritingEntryTag` / `Tag` / `User` 表迁移而来（保留原 id 与时间戳）。

## 测试

- `scripts/e2e/`：Playwright + 真实数据库的端到端回归（需在仓库根目录、配置 `.env` 后运行）
- `pnpm typecheck`：TypeScript 类型检查
