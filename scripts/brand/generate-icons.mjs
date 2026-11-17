#!/usr/bin/env node
/**
 * SekerEagle 九点阵品牌图标的唯一生成入口。
 *
 * 几何只有一个来源：128 单位画布、白色圆角块、3×3 黑色圆点。网页、桌面、
 * 安卓、浏览器扩展和 Eagle 导入插件都从这里派生，避免各端手改后再次漂移。
 * 白底与黑点必须不透明，只有圆角外侧允许透明。macOS 桌面图标例外：使用满画布
 * 不透明正方形、不预切圆角，由系统裁切圆角；预切圆角会被 macOS 26 当成旧式图标
 * 缩进灰色玻璃模板。
 *
 * 用法：
 *   node scripts/brand/generate-icons.mjs          生成并写回仓库
 *   node scripts/brand/generate-icons.mjs --check  只校验仓库里的产物是否最新
 */
import { Buffer } from 'node:buffer';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = process.argv.includes('--check');

/** 128 单位的标记画布；所有尺寸都由它等比缩放。 */
const CANVAS = 128;
const TILE_RADIUS = 28;
const DOT_RADIUS = 13;
const DOT_CENTERS = [32, 64, 96];
const DOT_FILL = '#000000';

/** 安卓自适应图标：108dp 图层、其中 72dp 是启动器保证可见的区域。 */
const ADAPTIVE_LAYER = 108;
const ADAPTIVE_VISIBLE = 72;

function circles(fill, centers = DOT_CENTERS, radius = DOT_RADIUS) {
  return centers.flatMap((cy) =>
    centers.map((cx) => `<circle cx="${cx}" cy="${cy}" r="${radius}"/>`),
  );
}

/** 仓库里的规范文件：网页引用、桌面连接页复制、插件 logo 都用它。 */
function markSvg({ square = false } = {}) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">',
    square
      ? '  <rect width="128" height="128" fill="white"/>'
      : `  <rect width="128" height="128" rx="${TILE_RADIUS}" fill="white"/>`,
    `  <g fill="${DOT_FILL}">`,
    `    ${circles(DOT_FILL).join('')}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

/** 按目标像素尺寸渲染时补上宽高，让 sharp 直接从矢量栅格化而不是放大小图。 */
function renderSvg(size, options = {}) {
  return markSvg(options).replace(
    'viewBox="0 0 128 128"',
    `width="${size}" height="${size}" viewBox="0 0 128 128"`,
  );
}

async function png(size, options = {}) {
  const buffer = await sharp(Buffer.from(renderSvg(size, options)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await assertOpaqueCore(buffer, size);
  return buffer;
}

/** 白底和黑点必须不透明：图标中部 40% 的 alpha 全部为 255，且白色、黑色都在。 */
async function assertOpaqueCore(buffer, size) {
  const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const core = Math.floor(size * 0.4);
  const start = Math.floor((size - core) / 2);
  const rgbAt = (x, y) => Array.from(data.subarray((y * size + x) * 4, (y * size + x) * 4 + 3));
  const alphaAt = (x, y) => data[(y * size + x) * 4 + 3];

  for (let y = start; y < start + core; y += 1) {
    for (let x = start; x < start + core; x += 1) {
      if (alphaAt(x, y) !== 255) {
        throw new Error(`${size}px 图标在 (${x},${y}) 出现透明像素，白底必须不透明`);
      }
    }
  }

  if (size >= 128) {
    const dot = rgbAt(Math.round((32 / CANVAS) * size), Math.round((32 / CANVAS) * size));
    if (dot.some((channel) => channel > 24)) {
      throw new Error(`${size}px 图标的圆点不是黑色：${dot.join(',')}`);
    }
    const field = rgbAt(Math.round(size / 2), Math.round((16 / CANVAS) * size));
    if (field.some((channel) => channel < 239)) {
      throw new Error(`${size}px 图标的底色不是白色：${field.join(',')}`);
    }
    return;
  }

  // 小尺寸的圆点只有一两个像素，抗锯齿会冲淡颜色，只要求黑白都出现。
  let darkest = 255;
  let lightest = 0;
  for (let y = start; y < start + core; y += 1) {
    for (let x = start; x < start + core; x += 1) {
      for (const channel of rgbAt(x, y)) {
        darkest = Math.min(darkest, channel);
        lightest = Math.max(lightest, channel);
      }
    }
  }
  if (darkest > 96 || lightest < 200) {
    throw new Error(`${size}px 图标缺少黑白对比：${darkest}..${lightest}`);
  }
}

/** 自适应图标前景：把 128 画布缩进 72dp 可见区，居中放进 108dp 图层。 */
function foregroundDrawable() {
  const scale = ADAPTIVE_VISIBLE / CANVAS;
  const offset = (ADAPTIVE_LAYER - ADAPTIVE_VISIBLE) / 2;
  const radius = DOT_RADIUS * scale;
  const pathData = DOT_CENTERS.flatMap((cy) =>
    DOT_CENTERS.map((cx) => {
      const x = offset + cx * scale;
      const y = offset + cy * scale;
      return `M${round(x - radius)},${round(y)}A${round(radius)},${round(radius)} 0 1 0 ${round(
        x + radius,
      )},${round(y)}A${round(radius)},${round(radius)} 0 1 0 ${round(x - radius)},${round(y)}Z`;
    }),
  ).join('');

  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${ADAPTIVE_LAYER}dp"`,
    `    android:height="${ADAPTIVE_LAYER}dp"`,
    `    android:viewportWidth="${ADAPTIVE_LAYER}"`,
    `    android:viewportHeight="${ADAPTIVE_LAYER}">`,
    '    <path',
    `        android:fillColor="${DOT_FILL}"`,
    `        android:pathData="${pathData}" />`,
    '</vector>',
    '',
  ].join('\n');
}

/** 通知栏小图标只能是单色剪影，系统会自行着色。 */
function notificationDrawable() {
  const centers = [12, 24, 36];
  const radius = 4.8;
  const pathData = centers
    .flatMap((cy) =>
      centers.map((cx) => {
        return `M${round(cx - radius)},${cy}A${radius},${radius} 0 1 0 ${round(
          cx + radius,
        )},${cy}A${radius},${radius} 0 1 0 ${round(cx - radius)},${cy}Z`;
      }),
    )
    .join('');

  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="24dp"',
    '    android:height="24dp"',
    '    android:viewportWidth="48"',
    '    android:viewportHeight="48">',
    '    <path',
    '        android:fillColor="#FFFFFFFF"',
    `        android:pathData="${pathData}" />`,
    '</vector>',
    '',
  ].join('\n');
}

function adaptiveIcon() {
  return [
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@color/ic_launcher_background" />',
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
    '</adaptive-icon>',
    '',
  ].join('\n');
}

function launcherColors() {
  return [
    '<resources>',
    '    <color name="ic_launcher_background">#FFFFFF</color>',
    '</resources>',
    '',
  ].join('\n');
}

function round(value) {
  return Number(value.toFixed(4));
}

/** 需要写回的文件：文本直接比对内容，PNG 比对字节。 */
async function textOutputs() {
  const mark = markSvg();
  return [
    { file: 'apps/web/src/assets/seker-eagle-logo.svg', content: mark },
    { file: 'plugins/browser-capture/icons/icon.svg', content: mark },
    { file: 'plugins/eagle-importer/logo.svg', content: mark },
    {
      file: 'apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml',
      content: foregroundDrawable(),
    },
    {
      file: 'apps/android/app/src/main/res/drawable/ic_notification.xml',
      content: notificationDrawable(),
    },
    {
      file: 'apps/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
      content: adaptiveIcon(),
    },
    {
      file: 'apps/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
      content: adaptiveIcon(),
    },
    {
      file: 'apps/android/app/src/main/res/values/colors.xml',
      content: launcherColors(),
    },
  ];
}

async function pngOutputs() {
  const sizes = [
    ['apps/desktop/build/icon.png', 1024, {}],
    ['apps/desktop/build/icon-mac.png', 1024, { square: true }],
    ['plugins/browser-capture/icons/icon-16.png', 16, {}],
    ['plugins/browser-capture/icons/icon-32.png', 32, {}],
    ['plugins/browser-capture/icons/icon-48.png', 48, {}],
    ['plugins/browser-capture/icons/icon-128.png', 128, {}],
  ];
  return Promise.all(
    sizes.map(async ([file, size, options]) => ({ file, content: await png(size, options) })),
  );
}

async function readExisting(file) {
  try {
    return await readFile(path.join(ROOT, file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const outputs = [...(await textOutputs()), ...(await pngOutputs())];
  const drifted = [];

  for (const { file, content } of outputs) {
    const existing = await readExisting(file);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    if (existing && existing.equals(buffer)) continue;
    drifted.push(file);
    if (!CHECK) {
      await mkdir(path.dirname(path.join(ROOT, file)), { recursive: true });
      await writeFile(path.join(ROOT, file), buffer);
    }
  }

  // 旧的金色字母 E 已被自适应图标取代，留着会让人以为还有第二套标记。
  const legacy = await readExisting('apps/android/app/src/main/res/drawable/app_icon.xml');
  if (legacy) {
    drifted.push('apps/android/app/src/main/res/drawable/app_icon.xml（应删除）');
    if (!CHECK)
      await unlink(path.join(ROOT, 'apps/android/app/src/main/res/drawable/app_icon.xml'));
  }

  if (CHECK) {
    if (drifted.length > 0) {
      process.stderr.write(`图标产物与生成脚本不一致：\n  ${drifted.join('\n  ')}\n`);
      process.stderr.write('运行 npm run brand:icons 重新生成。\n');
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    drifted.length === 0
      ? '图标产物已是最新。\n'
      : `已更新 ${drifted.length} 个图标产物：\n  ${drifted.join('\n  ')}\n`,
  );
}

await main();
