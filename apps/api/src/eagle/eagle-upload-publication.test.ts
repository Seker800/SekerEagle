import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';
import { EagleUploadService } from './eagle-upload.service';

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`publication uses a bounded budget beyond Prisma's five-second default (${mode})`, async () => {
    let options: { timeout?: number } | undefined;
    const { service } = fixture(mode, async (_callback, received) => {
      options = received;
      return { assetId: 'copy', duplicate: false };
    });
    await service.complete('owner', 'session', { parts: [{ partNumber: 1, etag: 'etag' }] });
    assert.equal(options?.timeout, 30_000);
  });

  test(`expired publication rolls back and keeps the same uploaded image retryable (${mode})`, async () => {
    let attempts = 0;
    const { service, writes } = fixture(mode, async () => {
      if (++attempts === 1)
        throw new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
          code: 'P2028',
          clientVersion: '6.19.3',
        });
      return { assetId: 'copy', duplicate: false };
    });
    await assert.rejects(
      service.complete('owner', 'session', { parts: [{ partNumber: 1, etag: 'etag' }] }),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        (error.getResponse() as { code: string }).code === 'UPLOAD_PUBLICATION_BUSY',
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.status, 'FAILED');
    assert.equal(writes[0]?.objectCleanupPending, false);
    assert.equal(
      writes[0]?.finalizationAttempts,
      undefined,
      'temporary lock pressure must not exhaust recovery attempts',
    );
    const result = await service.complete('owner', 'session', {
      parts: [{ partNumber: 1, etag: 'etag' }],
    });
    assert.equal(result.assetId, 'copy');
    assert.equal(attempts, 2);
  });
}

function fixture(
  mode: 'MATERIAL' | 'PHOTO',
  transact: (callback: unknown, options?: { timeout?: number }) => Promise<unknown>,
) {
  const writes: Array<Record<string, unknown>> = [];
  const session = {
    id: 'session',
    uploaderId: 'owner',
    status: 'ASSEMBLED',
    originalName: 'edited.png',
    mimeType: 'image/png',
    size: 5n,
    objectKey: 'users/owner/assets/copy/original.png',
    multipartUploadId: 'multipart',
    completionParts: [{ PartNumber: 1, ETag: 'etag' }],
    eagleState: {
      duplicatePolicy: 'CREATE_COPY',
      copySourceAssetId: 'source',
      copySourceRowVersion: 1,
    },
  };
  const service = new EagleUploadService(
    {
      uploadSession: {
        findFirst: async () => session,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push(data);
          return { count: 1 };
        },
      },
      $transaction: transact,
    } as never,
    { headObject: async () => ({ ContentLength: 5 }) } as never,
    {} as never,
    {
      inspect: async () => ({
        sha256: 'a'.repeat(64),
        format: 'png',
        width: 1,
        height: 1,
        durationMs: null,
      }),
    } as never,
    mode,
  );
  return { service, writes };
}

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`a concurrent publisher's committed copy is returned without checking a stale source (${mode})`, async () => {
    const { service } = fixture(mode, async (callback) =>
      (callback as (tx: unknown) => Promise<unknown>)({
        $queryRaw: async () => [],
        $executeRaw: async () => [],
        uploadSession: {
          updateMany: async () => ({ count: 0 }),
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            assert.equal(where.uploaderId, 'owner');
            assert.equal(where.libraryMode, mode);
            assert.equal(where.status, 'COMPLETED');
            return { eagleAssetId: 'already-published', objectCleanupPending: false };
          },
        },
        eagleAsset: {
          findFirst: async () =>
            assert.fail('completed publication must not revalidate its old source'),
        },
      }),
    );
    const result = await service.complete('owner', 'session', {
      parts: [{ partNumber: 1, etag: 'etag' }],
    });
    assert.equal(result.assetId, 'already-published');
  });
}

test('publication budget is configurable and rejects invalid resource budgets', async () => {
  const { uploadPublicationTimeoutMs } = await import('./eagle-upload-policy');
  const before = process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS;
  try {
    process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS = '45000';
    assert.equal(uploadPublicationTimeoutMs(), 45000);
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS = value;
      assert.throws(uploadPublicationTimeoutMs, /must be a positive integer/);
    }
  } finally {
    if (before === undefined) delete process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS;
    else process.env.EAGLE_UPLOAD_PUBLICATION_TIMEOUT_MS = before;
  }
});
