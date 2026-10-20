import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPhotoLut } from './photo-lut-storage';
import { createPhotoRenderer } from './photo-editor-render';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';

vi.mock('./photo-lut-storage', () => ({ loadPhotoLut: vi.fn() }));

interface Request {
  id: number;
  edits: typeof DEFAULT_PHOTO_EDITS;
}
class TestWorker {
  requests: Request[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(request: Request) {
    this.requests.push(request);
  }
  terminate = vi.fn();
  reply(index: number, error = false) {
    this.onmessage?.({
      data: {
        id: this.requests[index].id,
        error,
        pixels: error ? undefined : new Uint8Array([128, 128, 128, 255]),
      },
    } as MessageEvent);
  }
}
let worker: TestWorker;
beforeEach(() => {
  worker = new TestWorker();
  vi.stubGlobal('Worker', function () {
    return worker;
  });
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        getImageData: () => ({ data: new Uint8ClampedArray([128, 128, 128, 255]) }),
        putImageData: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const source = () => Object.assign(document.createElement('canvas'), { width: 1, height: 1 });

describe('bounded photo preview worker', () => {
  it('pans and zooms cached photos immediately, but recomputes effects anchored to the crop', async () => {
    const renderer = createPhotoRenderer(),
      photo = source();
    const first = renderer.render(photo, DEFAULT_PHOTO_EDITS);
    worker.reply(0);
    const result = await first;
    expect(await renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, cropZoom: 2, cropX: 0.1 })).toBe(
      result,
    );
    expect(worker.requests).toHaveLength(1);
    const vignette = renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, vignette: 40 });
    worker.reply(1);
    await vignette;
    const moved = renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, vignette: 40, cropZoom: 2 });
    expect(worker.requests).toHaveLength(3);
    worker.reply(2);
    await moved;
    renderer.dispose();
  });
  it('coalesces a rapid 50-step gesture into the running frame and the latest frame', async () => {
    const renderer = createPhotoRenderer(),
      photo = source();
    const jobs = Array.from({ length: 50 }, (_, contrast) =>
      renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, contrast }).then(
        () => 'done',
        (error: Error) => error.name,
      ),
    );
    expect(worker.requests).toHaveLength(1);
    worker.reply(0);
    expect(worker.requests).toHaveLength(2);
    expect(worker.requests[1].edits.contrast).toBe(49);
    worker.reply(1);
    const results = await Promise.all(jobs);
    expect(results.filter((value) => value === 'done')).toHaveLength(2);
    expect(results.filter((value) => value === 'AbortError')).toHaveLength(48);
    renderer.dispose();
  });
  it('reuses the processed proxy when only watermark text or theme changes', async () => {
    const renderer = createPhotoRenderer(),
      photo = source();
    const first = renderer.render(photo, DEFAULT_PHOTO_EDITS);
    worker.reply(0);
    const result = await first;
    expect(
      await renderer.render(photo, {
        ...DEFAULT_PHOTO_EDITS,
        watermark: 'photo-strip',
        watermarkCamera: 'Nikon Z5',
      }),
    ).toBe(result);
    expect(worker.requests).toHaveLength(1);
    const changed = renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, shadows: 25 });
    expect(worker.requests).toHaveLength(2);
    worker.reply(1);
    await changed;
    renderer.dispose();
  });
  it('rejects failures and resumes the latest pending request without leaving promises hanging', async () => {
    const renderer = createPhotoRenderer(),
      photo = source();
    const first = renderer
      .render(photo, DEFAULT_PHOTO_EDITS)
      .catch((error: Error) => error.message);
    const next = renderer.render(photo, { ...DEFAULT_PHOTO_EDITS, shadows: 20 });
    worker.reply(0, true);
    worker.reply(1);
    expect(await first).toBe('PHOTO_RENDER_FAILED');
    await expect(next).resolves.toBeInstanceOf(HTMLCanvasElement);
    const running = renderer
      .render(photo, { ...DEFAULT_PHOTO_EDITS, clarity: 10 })
      .catch((error: Error) => error.message);
    const queued = renderer
      .render(photo, { ...DEFAULT_PHOTO_EDITS, clarity: 20 })
      .catch((error: Error) => error.message);
    renderer.dispose();
    expect(await running).toBe('PHOTO_RENDER_FAILED');
    expect(await queued).toBe('PHOTO_RENDER_FAILED');
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(renderer.render(photo, DEFAULT_PHOTO_EDITS)).rejects.toThrow(
      'PHOTO_RENDER_FAILED',
    );
  });
});

it('loads the selected personal LUT into the same Worker request and fails when unavailable', async () => {
  const table = { size: 2, data: new Float32Array(24), domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
  vi.mocked(loadPhotoLut).mockResolvedValueOnce(table as Awaited<ReturnType<typeof loadPhotoLut>>);
  const renderer = createPhotoRenderer();
  const source = document.createElement('canvas');
  source.width = 1;
  source.height = 1;
  const pending = renderer.render(source, { ...DEFAULT_PHOTO_EDITS, filter: 'lut:private' });
  await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
  expect(worker.requests[0]).toMatchObject({ lut: table, edits: { filter: 'lut:private' } });
  worker.reply(0);
  await pending;
  vi.mocked(loadPhotoLut).mockRejectedValueOnce(new Error('LUT_NOT_FOUND'));
  await expect(
    renderer.render(source, { ...DEFAULT_PHOTO_EDITS, filter: 'lut:missing' }),
  ).rejects.toThrow('LUT_NOT_FOUND');
  vi.mocked(loadPhotoLut).mockResolvedValueOnce(table as Awaited<ReturnType<typeof loadPhotoLut>>);
  const retried = renderer.render(source, { ...DEFAULT_PHOTO_EDITS, filter: 'lut:missing' });
  await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
  worker.reply(1);
  await retried;
  renderer.dispose();
});
