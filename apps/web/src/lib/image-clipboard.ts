import { getDesktopClipboardBridge, resolveClipboardImageUrl } from './media-resolver';

const MAX_CLIPBOARD_PIXELS = 16_000_000;

interface ImageClipboardDependencies {
  convertToPng?: (source: Blob) => Promise<Blob>;
  createClipboardItem?: (items: Record<string, Blob | PromiseLike<string | Blob>>) => ClipboardItem;
  fetch?: typeof globalThis.fetch;
  write?: (items: ClipboardItem[]) => Promise<void>;
}

export function canCopyImageToClipboard(): boolean {
  if (getDesktopClipboardBridge()) return true;
  const clipboard = globalThis.navigator?.clipboard;
  return Boolean(
    globalThis.isSecureContext !== false &&
    typeof globalThis.ClipboardItem === 'function' &&
    typeof clipboard?.write === 'function',
  );
}

export async function copyImageToClipboard(
  sourceUrl: string,
  dependencies: ImageClipboardDependencies = {},
): Promise<void> {
  const desktop = getDesktopClipboardBridge();
  if (desktop) {
    const png = await loadClipboardPng(sourceUrl, dependencies);
    await desktop.writeClipboardImage(new Uint8Array(await png.arrayBuffer()));
    return;
  }

  const createClipboardItem =
    dependencies.createClipboardItem ??
    ((items: Record<string, Blob | PromiseLike<string | Blob>>) =>
      new globalThis.ClipboardItem(items));
  const writeClipboard =
    dependencies.write ??
    globalThis.navigator?.clipboard?.write?.bind(globalThis.navigator.clipboard);
  if (
    globalThis.isSecureContext === false ||
    !writeClipboard ||
    (!dependencies.createClipboardItem && typeof globalThis.ClipboardItem !== 'function')
  ) {
    throw new Error(
      globalThis.isSecureContext === false
        ? '当前网页地址不支持复制图片，请使用 localhost 或 HTTPS。'
        : '当前环境不支持复制图片。',
    );
  }
  const pngPromise = loadClipboardPng(sourceUrl, dependencies);
  await writeClipboard([createClipboardItem({ 'image/png': pngPromise })]);
}

async function loadClipboardPng(
  sourceUrl: string,
  dependencies: ImageClipboardDependencies,
): Promise<Blob> {
  const fetchImage = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImage(resolveClipboardImageUrl(sourceUrl), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`读取图片失败（${response.status}）。`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (!contentType?.startsWith('image/')) throw new Error('复制来源不是图片。');
  return (dependencies.convertToPng ?? convertImageToPng)(await response.blob());
}

async function convertImageToPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width * bitmap.height > MAX_CLIPBOARD_PIXELS
    ) {
      throw new Error('图片尺寸超出复制限制。');
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片复制画布。');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('无法编码剪贴板图片。');
    return png;
  } finally {
    bitmap.close();
  }
}
