import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SekerDesktopBridge } from './media-resolver';
import { copyImageToClipboard } from './image-clipboard';

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = {
  type: 'image/png',
  arrayBuffer: vi.fn(async () => pngBytes.buffer),
} as unknown as Blob;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
  delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
});

describe('image clipboard', () => {
  it('fails before fetching when the browser has no image clipboard capability', async () => {
    const fetchImage = vi.fn();

    await expect(
      copyImageToClipboard('/api/eagle/assets/a/renditions/b', { fetch: fetchImage }),
    ).rejects.toThrow(/不支持复制图片/);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('uses the native PNG conversion and ClipboardItem path in a browser', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((resolve: (blob: Blob | null) => void) => resolve(png)),
    };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 320, height: 180, close }),
    );
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    class TestClipboardItem {
      constructor(readonly items: Record<string, Blob | PromiseLike<string | Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', TestClipboardItem);
    const write = vi.fn(async ([item]: TestClipboardItem[]) => {
      await item.items['image/png'];
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });

    await copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
      fetch: vi.fn().mockResolvedValue(
        new Response('webp', {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        }),
      ),
    });

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('requests web clipboard access during the initiating user gesture', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchPending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const write = vi.fn(async ([item]: ClipboardItem[]) => {
      await (item as unknown as Record<string, PromiseLike<Blob>>)['image/png'];
    });
    const copying = copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
      createClipboardItem: vi.fn((items) => items as unknown as ClipboardItem),
      fetch: vi.fn(() => fetchPending),
      write,
    });

    expect(write).toHaveBeenCalledOnce();
    resolveFetch(new Response('no', { status: 404 }));
    await expect(copying).rejects.toThrow(/读取图片失败/);
  });

  it('fetches the authenticated preview, converts it to PNG, and writes through the web clipboard', async () => {
    const source = new Blob(['webp'], { type: 'image/webp' });
    const write = vi.fn(async ([item]: ClipboardItem[]) => {
      await (item as unknown as Record<string, PromiseLike<Blob>>)['image/png'];
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(source, { status: 200, headers: { 'content-type': 'image/webp' } }),
      );
    const convert = vi.fn().mockResolvedValue(png);
    const createClipboardItem = vi.fn(
      (items: Record<string, Blob | PromiseLike<string | Blob>>) =>
        items as unknown as ClipboardItem,
    );

    await copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
      convertToPng: convert,
      createClipboardItem,
      fetch: fetchMock,
      write,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/eagle/assets/a/renditions/b', {
      credentials: 'include',
    });
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/webp' }));
    expect(createClipboardItem).toHaveBeenCalledWith({ 'image/png': expect.any(Promise) });
    expect(write).toHaveBeenCalledOnce();
  });

  it('sends bounded PNG bytes through the desktop bridge instead of requesting clipboard permission', async () => {
    const writeClipboardImage = vi.fn().mockResolvedValue(undefined);
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    await copyImageToClipboard(
      `sekereagle-media://rendition/preview/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002`,
      {
        convertToPng: vi.fn().mockResolvedValue(png),
        fetch: fetchMock,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/eagle/assets/00000000-0000-4000-8000-000000000001/renditions/00000000-0000-4000-8000-000000000002',
      { credentials: 'include' },
    );
    expect(writeClipboardImage).toHaveBeenCalledWith(pngBytes);
  });

  it('rejects unsuccessful or non-image responses before touching the clipboard', async () => {
    const clipboard = {
      createClipboardItem: (items: Record<string, Blob | PromiseLike<string | Blob>>) =>
        items as unknown as ClipboardItem,
      write: async ([item]: ClipboardItem[]) => {
        await (item as unknown as Record<string, PromiseLike<Blob>>)['image/png'];
      },
    };
    await expect(
      copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
        ...clipboard,
        fetch: vi.fn().mockResolvedValue(new Response('no', { status: 404 })),
      }),
    ).rejects.toThrow(/读取图片失败/);

    await expect(
      copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
        ...clipboard,
        fetch: vi
          .fn()
          .mockResolvedValue(
            new Response('html', { status: 200, headers: { 'content-type': 'text/html' } }),
          ),
      }),
    ).rejects.toThrow(/不是图片/);
  });
});
