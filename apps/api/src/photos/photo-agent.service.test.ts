import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PhotoAgentService } from './photo-agent.service';
import { PhotoAgentController } from './photo-agent.controller';
import { CreatePhotoTaskDto } from './photo-agent.dto';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';

test('task creation rejects partial visibility and never persists out-of-scope resources', async () => {
  let writes = 0;
  const tx = {
    eagleAsset: { findMany: async () => [] },
    eaglePhotoAgentTask: {
      create: async () => {
        writes++;
      },
    },
  };
  const service = new PhotoAgentService(
    { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never,
    {} as never,
  );
  await assert.rejects(
    service.createTask('owner', { assetIds: ['hidden'], kind: 'CITY' }, false),
    /不存在/,
  );
  assert.equal(writes, 0);
});
test('DTO rejects ownerId, excess scope and unsupported modes', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const input of [
    { assetIds: ['00000000-0000-4000-8000-000000000001'], kind: 'CITY', ownerId: 'other' },
    { assetIds: [], kind: 'CITY' },
    { assetIds: ['00000000-0000-4000-8000-000000000001'], kind: 'CITY', libraryMode: 'MATERIAL' },
  ])
    await assert.rejects(pipe.transform(input, { type: 'body', metatype: CreatePhotoTaskDto }));
});
test('accept, reject, undo and cancel are browser-only operations', () => {
  for (const name of ['review', 'undo', 'cancel']) {
    const handler = Reflect.get(PhotoAgentController.prototype, name) as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    assert.ok(guards.includes(BrowserPrincipalGuard));
  }
});

test('date range comparisons use instants rather than ISO string ordering across timezone offsets', async () => {
  const service = new PhotoAgentService(
    { eagleAsset: { findMany: async () => [] } } as never,
    {} as never,
  );
  const result = await service.photos(
    'owner',
    { limit: 10, from: '2026-10-01T10:00:00+08:00', to: '2026-10-01T03:00:00Z' },
    false,
  );
  assert.deepEqual(result.items, []);
  await assert.rejects(
    service.photos(
      'owner',
      { limit: 10, from: '2026-10-01T03:00:00Z', to: '2026-10-01T10:00:00+08:00' },
      false,
    ),
    /范围/,
  );
});

test('agent previews use the same safe media disposition as browser previews', async () => {
  const headers = new Map<string, string>();
  const controller = new PhotoAgentController({ preview: async () => 'rendition' } as never, {
    getRendition: async () => ({stream: (await import('node:stream')).Readable.from('test'), fileName: 'untrusted.svg', mimeType: 'image/svg+xml'}),
  } as never);
  const file = await controller.preview({sub: 'owner', canViewPrivate: false} as never, 'asset', {setHeader: (name: string, value: string) => headers.set(name, value)} as never);
  assert.ok(file.getHeaders().disposition?.startsWith('attachment'));
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
});
