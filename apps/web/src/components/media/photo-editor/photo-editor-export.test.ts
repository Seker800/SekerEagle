import { afterEach, expect, it, vi } from 'vitest';
import { loadEditablePhoto, photoExportEncoding } from './photo-editor-export';

afterEach(() => vi.unstubAllGlobals());

it('sets credentialed CORS before requesting a canvas-readable full-size image', async () => {
  const requests: Array<{ source: string; crossOrigin: string }> = [];
  vi.stubGlobal(
    'Image',
    class {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(source: string) {
        requests.push({ source, crossOrigin: this.crossOrigin });
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const source = 'sekereagle-media://rendition/photo/preview/image/full';
  await loadEditablePhoto(source, new AbortController().signal);
  expect(requests).toEqual([{ source, crossOrigin: 'use-credentials' }]);
});

it('re-encodes each source format instead of inflating every photo into PNG', () => {
  expect(photoExportEncoding('image/jpeg')).toEqual({ mimeType: 'image/jpeg', quality: 0.92 });
  expect(photoExportEncoding('image/png')).toEqual({ mimeType: 'image/png' });
  expect(photoExportEncoding('image/webp')).toEqual({ mimeType: 'image/webp', quality: 0.92 });
  expect(photoExportEncoding('image/x-adobe-dng')).toEqual({
    mimeType: 'image/jpeg',
    quality: 0.92,
  });
});
