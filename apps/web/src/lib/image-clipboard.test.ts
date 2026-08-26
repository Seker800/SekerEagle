import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SekerDesktopBridge } from './media-resolver';
import { copyImageToClipboard } from './image-clipboard';

const png = new Blob(['png'], { type: 'image/png' });

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { sekerDesktop?: SekerDesktopBridge }).sekerDesktop;
});

describe('image clipboard', () => {
  it('fetches the authenticated preview, converts it to PNG, and writes through the web clipboard', async () => {
    const source = new Blob(['webp'], { type: 'image/webp' });
    const write = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(source, { status: 200 }));
    const convert = vi.fn().mockResolvedValue(png);
    const createClipboardItem = vi.fn((items: Record<string, Blob>) => items);

    await copyImageToClipboard('/api/eagle/assets/a/renditions/b', {
      convertToPng: convert,
      createClipboardItem,
      fetch: fetchMock,
      write,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/eagle/assets/a/renditions/b', {
      credentials: 'include',
    });
    expect(convert).toHaveBeenCalledWith(source);
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(png, { status: 200 }));

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
    expect(writeClipboardImage).toHaveBeenCalledWith(new Uint8Array(await png.arrayBuffer()));
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
