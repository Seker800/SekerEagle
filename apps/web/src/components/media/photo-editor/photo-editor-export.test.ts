import { afterEach, expect, it, vi } from 'vitest';
import { loadEditablePhoto } from './photo-editor-export';

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
