import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { EagleImportController } from './eagle-import.controller';
import { EagleUploadController } from './eagle-upload.controller';

test('bulk import controllers retain authentication and token scopes without request quotas', () => {
  for (const controller of [EagleImportController, EagleUploadController]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, controller), [
      AccessAuthGuard,
      PatScopeGuard,
    ]);
  }
});

test('accepted uploads return the durable session status without finalizing in the HTTP process', async () => {
  const finalized: unknown[] = [];
  const controller = new EagleUploadController(
    {
      complete: async () => ({ uploadSessionId: 'session-1', status: 'ASSEMBLED' }),
    } as never,
    {
      finalizeUpload: async (...args: unknown[]) => {
        finalized.push(args);
      },
    } as never,
  );

  const result = await controller.complete({ sub: ownerId } as never, 'session-1', {
    parts: [{ partNumber: 1, etag: 'etag-1' }],
  });

  assert.deepEqual(result, { uploadSessionId: 'session-1', status: 'ASSEMBLED' });
  assert.deepEqual(finalized, []);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata belongs to the method itself
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, controller.complete), 202);
});

const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
