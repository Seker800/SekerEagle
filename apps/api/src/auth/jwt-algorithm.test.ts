import assert from 'node:assert/strict';
import test from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { SessionTokenService } from './session-token.service';
import { PrivacyVisibilityService } from './privacy-visibility.service';

test('access and privacy grants accept HS256 only even with the correct signing secret', async () => {
  const jwt = new JwtService({ secret: 'synthetic-test-only-secret-32-characters' });
  const db = {
    user: { findUnique: async () => ({ id: 'owner', email: 'owner@example.invalid', role: 'USER', authVersion: 1, disabledAt: null }) },
    refreshToken: { findFirst: async () => ({ id: 'session' }) },
  };
  const sessions = new SessionTokenService(db as never, jwt, {} as never);
  const privacy = new PrivacyVisibilityService(db as never, jwt, {} as never);
  const access = { sub: 'owner', kind: 'browser', authVersion: 1, sessionFamilyId: 'family' };
  for (const algorithm of ['HS384', 'HS512'] as const) {
    await assert.rejects(sessions.verifyAccessToken(await jwt.signAsync(access, { algorithm, expiresIn: 60 })));
    const token = await jwt.signAsync({ sub: 'owner', kind: 'privacy-visibility', libraryMode: 'PHOTO' }, { algorithm, expiresIn: 60 });
    assert.equal(await privacy.readGrant('owner', { cookies: { sekereagle_photo_privacy_visibility: token } } as never, 'PHOTO'), null);
  }
  assert.equal((await sessions.verifyAccessToken(await jwt.signAsync(access, { algorithm: 'HS256', expiresIn: 60 }))).sub, 'owner');
});
