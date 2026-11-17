import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SekerDesktopBridge } from './media-resolver';
import {
  canCopyImageToClipboard,
  copyImageToClipboard,
  copyShareImageToClipboard,
} from './image-clipboard';

const { fetchWithBrowserSessionMock } = vi.hoisted(() => ({
  fetchWithBrowserSessionMock: vi.fn(),
}));
vi.mock('./api-client', () => ({
  fetchWithBrowserSession: (...args: unknown[]) => fetchWithBrowserSessionMock(...args),
}));

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = {
  type: 'image/png',
  arrayBuffer: vi.fn(async () => pngBytes.buffer),
} as unknown as Blob;

afterEach(() => {
  fetchWithBrowserSessionMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
  delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
});

describe('image clipboard', () => {
  it('reports image clipboard availability for secure web and desktop contexts', () => {
    class TestClipboardItem {}
    vi.stubGlobal('ClipboardItem', TestClipboardItem);
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn() },
    });
    expect(canCopyImageToClipboard()).toBe(true);

    vi.stubGlobal('isSecureContext', false);
    expect(canCopyImageToClipboard()).toBe(false);

    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage: vi.fn(),
    };
    expect(canCopyImageToClipboard()).toBe(true);
  });

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

  it('hands the 4K JPEG straight to the desktop clipboard bridge', async () => {
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    fetchWithBrowserSessionMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => jpegBytes.buffer,
    });
    const writeClipboardImageData = vi.fn();
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage: vi.fn(),
      writeClipboardImageData,
    };

    await copyShareImageToClipboard('/api/eagle/assets/asset-1/share-image');

    expect(fetchWithBrowserSessionMock).toHaveBeenCalledWith(
      '/api/eagle/assets/asset-1/share-image',
      {},
      120_000,
    );
    expect(writeClipboardImageData).toHaveBeenCalledWith({
      contentType: 'image/jpeg',
      bytes: jpegBytes,
    });
  });

  it('falls back to the original PNG bridge on desktop builds without JPEG support', async () => {
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    fetchWithBrowserSessionMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => jpegBytes.buffer,
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((resolve: (blob: Blob | null) => void) => resolve(png)),
    };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4_096, height: 2_731, close: vi.fn() }),
    );
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const writeClipboardImage = vi.fn();
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage,
    };

    await copyShareImageToClipboard('/api/eagle/assets/asset-1/share-image');

    expect(writeClipboardImage).toHaveBeenCalledWith(pngBytes);
  });

  it('converts the 4K JPEG before writing the browser clipboard', async () => {
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    fetchWithBrowserSessionMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => jpegBytes.buffer,
    });
    const close = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((resolve: (blob: Blob | null) => void) => resolve(png)),
    };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4_096, height: 2_731, close }),
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

    await copyShareImageToClipboard('/api/eagle/assets/asset-1/share-image');

    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(4_096);
  });

  it('rejects non-JPEG share responses before touching the clipboard', async () => {
    fetchWithBrowserSessionMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const writeClipboardImageData = vi.fn();
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage: vi.fn(),
      writeClipboardImageData,
    };

    await expect(
      copyShareImageToClipboard('/api/eagle/assets/asset-1/share-image'),
    ).rejects.toThrow(/不是图片/);
    expect(writeClipboardImageData).not.toHaveBeenCalled();
  });
});
