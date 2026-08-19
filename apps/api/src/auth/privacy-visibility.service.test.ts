import assert from 'node:assert/strict';
import test from 'node:test';
import { PrivacyVisibilityService } from './privacy-visibility.service';

test('privacy visibility defaults to three hours and is disabled without a browser grant', async () => {
  const service = new PrivacyVisibilityService(
    {
      eaglePrivacyPreference: { findUnique: async () => null },
    } as never,
    { verifyAsync: async () => Promise.reject(new Error('missing')) } as never,
    { getOrThrow: () => 'http://localhost:8180' } as never,
  );

  assert.deepEqual(await service.getStatus('owner-1', {} as never), {
    enabled: false,
    durationHours: 3,
    expiresAt: null,
  });
});

test('enabling visibility stores the allowed duration in a scoped HttpOnly cookie', async () => {
  let preference = 0;
  let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
  const service = new PrivacyVisibilityService(
    {
      eaglePrivacyPreference: {
        upsert: async ({ create }: { create: { durationHours: number } }) => {
          preference = create.durationHours;
        },
      },
    } as never,
    { signAsync: async () => 'signed-grant' } as never,
    { getOrThrow: () => 'http://localhost:8180' } as never,
  );
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookie = { name, value, options };
    },
  };

  const result = await service.update('owner-1', response as never, {
    enabled: true,
    durationHours: 6,
  });

  assert.equal(preference, 6);
  assert.equal(cookie?.name, 'sekereagle_privacy_visibility');
  assert.equal(cookie?.value, 'signed-grant');
  assert.equal(cookie?.options.httpOnly, true);
  assert.equal(cookie?.options.sameSite, 'strict');
  assert.equal(cookie?.options.maxAge, 6 * 60 * 60 * 1000);
  assert.equal(result.enabled, true);
  assert.equal(result.durationHours, 6);
  assert.ok(result.expiresAt);
});
