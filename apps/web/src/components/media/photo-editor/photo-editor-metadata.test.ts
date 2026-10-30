import { afterEach, expect, it, vi } from 'vitest';
import { readPhotoMetadata } from './photo-editor-metadata';
const parseMock = vi.hoisted(() => vi.fn());
vi.mock('exifr', () => ({ parse: parseMock }));
afterEach(() => {
  vi.unstubAllGlobals();
  parseMock.mockReset();
});
it('bounds EXIF fetches so metadata cannot block saving forever', async () => {
  const parent = new AbortController();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      requestSignal = options.signal;
      return Promise.reject(new Error('offline'));
    }),
  );
  await expect(readPhotoMetadata('/image', parent.signal)).rejects.toThrow('offline');
  expect(requestSignal).not.toBe(parent.signal);
  parent.abort();
  expect(requestSignal?.aborted).toBe(true);
});

it('loads the EXIF parser on demand and reads only photography fields', async () => {
  const blob = new Blob(['photo']);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
  parseMock.mockResolvedValue({
    Make: 'Sony',
    Model: 'A7',
    FocalLength: 50,
    FNumber: 2,
    ExposureTime: 0.01,
    ISO: 100,
    DateTimeOriginal: new Date(2026, 3, 10, 12, 30),
  });
  expect(await readPhotoMetadata('/image', new AbortController().signal)).toEqual({
    camera: 'Sony A7',
    parameters: '50mm  ·  f/2  ·  1/100s  ·  ISO 100',
    capturedAt: '2026.04.10 12:30',
  });
  expect(parseMock).toHaveBeenCalledWith(
    blob,
    expect.objectContaining({
      gps: false,
      xmp: false,
      iptc: false,
      icc: false,
      pick: expect.arrayContaining(['Make', 'Model']),
    }),
  );
});
