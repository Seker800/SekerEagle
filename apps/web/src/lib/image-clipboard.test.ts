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
  delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
});

describe('image clipboard', () => {
  it('requests web clipboard access during the initiating user gesture', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchPending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const write = vi.fn().mockResolvedValue(undefined);
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
    const write = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(source, { status: 200, headers: { 'content-type': 'image/webp' } }),
    );
    const convert = vi.fn().mockResolvedValue(png);
    const createClipboardItem = vi.fn(
      (items: Record<string, Blob>) => items as unknown as ClipboardItem,
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
    expect(createClipboardItem).toHaveBeenCalledWith({ 'image/png': png });
    expect(write).toHaveBeenCalledOnce();
  });

  it('sends bounded PNG bytes through the desktop bridge instead of requesting clipboard permission', async () => {
    const writeClipboardImage = vi.fn().mockResolvedValue(undefined);
    (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      writeClipboardImage,
    };
    const fetchMock = vi.fn().mockResolvedValue(
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
    await expect(
      copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
        fetch: vi.fn().mockResolvedValue(new Response('no', { status: 404 })),
      }),
    ).rejects.toThrow(/读取图片失败/);

    await expect(
      copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
        fetch: vi.fn().mockResolvedValue(
          new Response('html', { status: 200, headers: { 'content-type': 'text/html' } }),
        ),
      }),
    ).rejects.toThrow(/不是图片/);
  });
});
