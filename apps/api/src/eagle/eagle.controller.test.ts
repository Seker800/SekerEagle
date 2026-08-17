import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { EagleController } from './eagle.controller';

test('revision-addressed renditions use immutable private caching', async () => {
  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    vary: () => undefined,
    status: () => undefined,
  };
  const controller = new EagleController(
    {} as never,
    {} as never,
    {
      getRendition: async () => ({
        notModified: false,
        fileName: 'preview.webp',
        mimeType: 'image/webp',
        contentLength: 3,
        fullSize: 3n,
        etag: 'etag-1',
        lastModified: new Date('2026-08-16T00:00:00.000Z'),
        stream: Readable.from(Buffer.from('webp')),
      }),
    } as never,
  );

  await controller.getRenditionContent(
    { sub: 'owner-a' } as never,
    'asset-1',
    'rendition-1',
    undefined,
    response as never,
  );

  assert.equal(headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.equal(headers.get('Last-Modified'), 'Sun, 16 Aug 2026 00:00:00 GMT');
});
