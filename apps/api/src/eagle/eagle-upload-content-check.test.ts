import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckUploadContentDto } from './eagle-upload.dto';
import { EagleUploadService } from './eagle-upload.service';
import { EagleUploadController } from './eagle-upload.controller';

test('content preflight is bounded to owner, mode, size and visible non-deleted resources', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    for (const privateAccess of [false, true]) {
      let query: unknown;
      const service = new EagleUploadService(
        {
          eagleAsset: {
            findFirst: async (input: unknown) => {
              query = input;
              return { id: 'known' };
            },
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
        mode,
      );
      assert.deepEqual(
        await service.checkContent(
          'authenticated-owner',
          { contentSha256: 'A'.repeat(64), size: 12 },
          privateAccess,
        ),
        { exists: true },
      );
      assert.deepEqual(query, {
        where: {
          ownerId: 'authenticated-owner',
          libraryMode: mode,
          sha256: 'a'.repeat(64),
          byteSize: 12n,
          deletedAt: null,
          purgeAfter: null,
          ...(privateAccess ? {} : { isPrivate: false }),
        },
        select: { id: true },
      });
    }
  }
});

test('absent, foreign, private or recycled content has the same preflight response', async () => {
  const service = new EagleUploadService(
    { eagleAsset: { findFirst: async () => null } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  assert.deepEqual(
    await service.checkContent('owner', { contentSha256: 'b'.repeat(64), size: 10 }),
    { exists: false },
  );
});

test('content preflight takes identity from authentication and never returns an asset identifier', async () => {
  const calls: unknown[] = [];
  const controller = new EagleUploadController(
    {
      checkContent: async (...args: unknown[]) => {
        calls.push(args);
        return { exists: true };
      },
    } as never,
    {} as never,
  );
  const input = { contentSha256: 'a'.repeat(64), size: 12 };
  assert.deepEqual(
    await controller.checkContent({ sub: 'owner', canViewPrivate: false } as never, input),
    { exists: true },
  );
  assert.deepEqual(calls, [['owner', input, false]]);
});

test('preflight DTO rejects malformed hashes, unbounded sizes and owner injection', async () => {
  for (const input of [
    { contentSha256: 'wrong', size: 1 },
    { contentSha256: 'a'.repeat(64), size: 0 },
    { contentSha256: 'a'.repeat(64), size: 5_000_000_001 },
    { contentSha256: 'a'.repeat(64), size: 1, ownerId: 'foreign' },
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(CheckUploadContentDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  }
  assert.equal(
    (
      await validate(
        plainToInstance(CheckUploadContentDto, { contentSha256: 'A'.repeat(64), size: 12 }),
      )
    ).length,
    0,
  );
});

test('preflight has a typed boolean contract and uses the shared authenticated owner throttle', async () => {
  const { CheckUploadContentResultDto } = await import('./eagle-upload.dto');
  const { EagleMediaThrottleGuard } = await import('./eagle-media-throttle.guard');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { PhotoUploadsController } = await import('../photos/photo-library.module');
  assert.ok(CheckUploadContentResultDto);
  for (const controller of [EagleUploadController, PhotoUploadsController]) {
    const handler = Reflect.get(controller.prototype, 'checkContent') as object;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    assert.ok(guards.includes(EagleMediaThrottleGuard));
  }
});
