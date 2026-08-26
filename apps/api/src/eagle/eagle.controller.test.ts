import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { EagleController } from './eagle.controller';
import { EagleMediaThrottleGuard } from './eagle-media-throttle.guard';

function controllerMethod(name: keyof EagleController): object {
  const method = Object.getOwnPropertyDescriptor(EagleController.prototype, name)?.value as unknown;
  assert.equal(typeof method, 'function');
  return method as object;
}

test('authenticated media reads use a dedicated owner-aware guard without changing API limits', () => {
  const mediaHandlers = [
    controllerMethod('getRendition'),
    controllerMethod('getRenditionContent'),
    controllerMethod('getPyramidTile'),
  ];

  for (const handler of mediaHandlers) {
    assert.equal(Reflect.getMetadata(`${THROTTLER_SKIP}short`, handler), true);
    assert.equal(Reflect.getMetadata(`${THROTTLER_SKIP}default`, handler), true);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [EagleMediaThrottleGuard]);
  }

  assert.equal(
    Reflect.getMetadata(`${THROTTLER_SKIP}short`, controllerMethod('listAssets')),
    undefined,
  );
  assert.equal(
    Reflect.getMetadata(`${THROTTLER_SKIP}short`, controllerMethod('getOriginal')),
    undefined,
  );
});

test('media throttle overrides do not weaken Eagle authentication guards', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, EagleController) as unknown[];
  assert.deepEqual(guards, [AccessAuthGuard, BrowserPrincipalGuard]);
});

test('body-based filter counts require a same-origin browser request', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, controllerMethod('countAssets')) as unknown[];
  assert.deepEqual(guards, [BrowserOriginGuard]);
});

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
        desktopCacheEligible: true,
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
  assert.equal(headers.get('X-SekerEagle-Desktop-Cache'), 'public-derived-v1');
});

test('private derived media remains no-store even for a principal with a private visibility window', async () => {
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
        desktopCacheEligible: false,
        stream: Readable.from(Buffer.from('webp')),
      }),
    } as never,
  );

  await controller.getRenditionContent(
    { sub: 'owner-a', canViewPrivate: true } as never,
    'asset-1',
    'rendition-1',
    undefined,
    response as never,
  );

  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(headers.has('X-SekerEagle-Desktop-Cache'), false);
});
