import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadOriginalFiles, saveOriginalFile } from './original-file-export';

const first = { id: 'asset-1', originalName: 'first image.png' };
const second = { id: 'asset-2', originalName: 'second.jpg' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('original file export', () => {
  it('uses the desktop Save As capability when available', async () => {
    const saveOriginalFileBridge = vi.fn().mockResolvedValue({ saved: true });
    const triggerBrowserDownload = vi.fn();

    await saveOriginalFile(first, {
      desktopBridge: { saveOriginalFile: saveOriginalFileBridge },
      triggerBrowserDownload,
    });

    expect(saveOriginalFileBridge).toHaveBeenCalledWith('asset-1');
    expect(triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it('starts a same-origin browser download synchronously for Save As', () => {
    const triggerBrowserDownload = vi.fn();

    const saving = saveOriginalFile(first, { desktopBridge: null, triggerBrowserDownload });

    expect(triggerBrowserDownload).toHaveBeenCalledWith(
      '/api/eagle/assets/asset-1/original',
      'first image.png',
    );
    return saving;
  });

  it('starts every selected browser download in library order', async () => {
    const triggerBrowserDownload = vi.fn();

    await downloadOriginalFiles([first, second], {
      desktopBridge: null,
      triggerBrowserDownload,
    });

    expect(triggerBrowserDownload.mock.calls).toEqual([
      ['/api/eagle/assets/asset-1/original', 'first image.png'],
      ['/api/eagle/assets/asset-2/original', 'second.jpg'],
    ]);
  });
});
