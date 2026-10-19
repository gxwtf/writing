#!/usr/bin/env node
/**
 * 作文积累本 · 图标与 iOS 启动图生成器
 *
 * 图形：lucide「notebook-pen」（笔记本 + 笔），与广坊主站 React 首页
 *      「作文积累本」子系统卡片使用的图标一致；配色沿用本站品牌色。
 *
 * 用法：
 *   node scripts/generate-icons.mjs                 # 默认 brand 配色，写入 public/
 *   node scripts/generate-icons.mjs --variant=light # 浅底配色
 *   node scripts/generate-icons.mjs --out=/tmp/prev # 只输出到临时目录预览
 *
 * 产物（public/）：
 *   icon.svg                       SVG 母版
 *   icon-192.png / icon-512.png    普通图标（purpose: any）
 *   icon-maskable-512.png          可裁切图标（purpose: maskable，图形收进安全区）
 *   apple-touch-icon.png           iOS 主屏图标 180×180
 *   favicon.ico                    浏览器标签页图标（16/32/48）
 *   splash/apple-splash-*.png      iOS 启动图（13 种尺寸）
 *
 * 依赖：sharp（Next 自带依赖）或 rsvg-convert / ImageMagick，按顺序探测。
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 配色方案：bg = 图标底色渐变（起 → 止），fg = 图形颜色 */
const VARIANTS = {
  // 实验红实底 + 白笔：与站内品牌色、theme-color 一致，主屏上最醒目
  brand: { from: '#C22525', to: '#8A1010', fg: '#FFFFFF', splashFg: '#A31F24' },
  // 浅红底 + 实验红图形：与广学英语图标（浅蓝底 + 蓝图形）同一语言
  light: { from: '#FDF6F5', to: '#EBE2E1', fg: '#A31F24', splashFg: '#A31F24' },
  // 主站 React 卡片配色（靛蓝 → 紫）：与主站视觉呼应
  indigo: { from: '#4F46E5', to: '#7C3AED', fg: '#FFFFFF', splashFg: '#4F46E5' },
};

/** lucide notebook-pen（24×24，stroke-width 2） */
const GLYPH = [
  'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4',
  'M2 6h4',
  'M2 10h4',
  'M2 14h4',
  'M2 18h4',
  'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z',
];

const SPLASH_SIZES = [
  [1290, 2796], [1179, 2556], [1170, 2532], [1284, 2778], [1242, 2688],
  [1125, 2436], [828, 1792], [750, 1334], [640, 1136], [2048, 2732],
  [1668, 2388], [1620, 2160], [1536, 2048],
];

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const variantName = getArg('variant', 'light');
const outDir = path.resolve(ROOT, getArg('out', 'public'));
const variant = VARIANTS[variantName];
if (!variant) {
  console.error(`未知配色：${variantName}（可选：${Object.keys(VARIANTS).join(' / ')}）`);
  process.exit(1);
}

/**
 * 图标 SVG。
 * @param {number} size 画布边长
 * @param {object} opts
 * @param {number} [opts.glyphRatio] 图形占画布比例（maskable 需留安全边距）
 * @param {boolean} [opts.background] 是否铺底色（启动图不需要）
 */
function iconSvg(size, { glyphRatio = 0.6, strokeWidth = 2, background = true, bg, fg } = {}) {
  const colors = bg ? { from: bg[0], to: bg[1], fg } : variant;
  const box = size * glyphRatio;
  const offset = (size - box) / 2;
  const scale = box / 24;
  const stroke = strokeWidth;
  const bgRect = background
    ? `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.from}"/>
      <stop offset="1" stop-color="${colors.to}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <g transform="translate(${offset.toFixed(3)} ${offset.toFixed(3)}) scale(${scale.toFixed(5)})"
     fill="none" stroke="${colors.fg}" stroke-width="${stroke}"
     stroke-linecap="round" stroke-linejoin="round">
    ${GLYPH.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`;
}

/** 启动图：白底 + 品牌色图形，居中（与广学英语一致） */
function splashSvg(w, h) {
  const box = Math.round(Math.min(w, h) * 0.22);
  const scale = box / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#FFFFFF"/>
  <g transform="translate(${((w - box) / 2).toFixed(3)} ${((h - box) / 2).toFixed(3)}) scale(${scale.toFixed(5)})"
     fill="none" stroke="${variant.splashFg}" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round">
    ${GLYPH.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`;
}

/* ---------------- 渲染后端：sharp → rsvg-convert → ImageMagick ---------------- */

async function loadRenderer() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try {
    candidates.push(require.resolve('sharp'));
  } catch {
    // Next 会把 sharp 装在 pnpm store 深处
    try {
      const { readdirSync } = await import('node:fs');
      const store = path.join(ROOT, 'node_modules/.pnpm');
      const dir = readdirSync(store).find((d) => d.startsWith('sharp@'));
      if (dir) candidates.push(require.resolve(path.join(store, dir, 'node_modules/sharp')));
    } catch {
      /* ignore */
    }
  }
  for (const resolved of candidates) {
    const sharp = require(resolved);
    return async (svg, w, h) => sharp(Buffer.from(svg)).resize(w, h).png().toBuffer();
  }
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
    return async (svg, w, h) => {
      const tmp = path.join(outDir, `.tmp-${Date.now()}.svg`);
      await writeFile(tmp, svg);
      try {
        return execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), tmp]);
      } finally {
        await rm(tmp, { force: true });
      }
    };
  } catch {
    /* ignore */
  }
  try {
    execFileSync('convert', ['--version'], { stdio: 'ignore' });
    return async (svg, w, h) => {
      const tmp = path.join(outDir, `.tmp-${Date.now()}.svg`);
      await writeFile(tmp, svg);
      try {
        return execFileSync('convert', ['-background', 'none', tmp, '-resize', `${w}x${h}!`, 'png:-']);
      } finally {
        await rm(tmp, { force: true });
      }
    };
  } catch {
    throw new Error('未找到可用的 SVG 渲染器（sharp / rsvg-convert / ImageMagick）');
  }
}

async function main() {
  await mkdir(path.join(outDir, 'splash'), { recursive: true });
  const render = await loadRenderer();

  const outputs = [];
  const emit = async (rel, buf) => {
    await writeFile(path.join(outDir, rel), buf);
    outputs.push(rel);
  };

  // SVG 母版
  await emit('icon.svg', iconSvg(512, { glyphRatio: 0.6 }));

  // 普通图标
  for (const size of [192, 512]) {
    await emit(`icon-${size}.png`, await render(iconSvg(size, { glyphRatio: 0.6 }), size, size));
  }

  // maskable：图形收进 80% 安全区内
  await emit(
    'icon-maskable-512.png',
    await render(iconSvg(512, { glyphRatio: 0.46 }), 512, 512),
  );

  // iOS 主屏图标（不透明、无圆角，交给系统裁切）
  await emit('apple-touch-icon.png', await render(iconSvg(180, { glyphRatio: 0.6 }), 180, 180));

  // 启动图
  for (const [w, h] of SPLASH_SIZES) {
    await emit(`splash/apple-splash-${w}x${h}.png`, await render(splashSvg(w, h), w, h));
  }

  // favicon.ico（16/32/48），交给 ImageMagick 打包多尺寸
  try {
    const tmpFiles = [];
    for (const size of [16, 32, 48]) {
      const tmp = `/tmp/favicon-${size}-${Date.now()}.png`;
      await writeFile(tmp, await render(iconSvg(size, { glyphRatio: 0.88, strokeWidth: 2.6 }), size, size));
      tmpFiles.push(tmp);
    }
    execFileSync('convert', [...tmpFiles, path.join(outDir, 'favicon.ico')]);
    outputs.push('favicon.ico');
    await Promise.all(tmpFiles.map((f) => rm(f, { force: true })));
  } catch (err) {
    console.warn(`跳过 favicon.ico（${err.message}）`);
  }

  console.log(`配色：${variantName}`);
  console.log(`输出目录：${outDir}`);
  console.log(outputs.map((o) => `  ✓ ${o}`).join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
