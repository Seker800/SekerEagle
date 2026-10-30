import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionTokenService } from './session-token.service';

test('malformed signed account or family identifiers fail closed before any query', async () => {
  for (const identifiers of [
    { sub: undefined, sessionFamilyId: 'family' },
    { sub: '', sessionFamilyId: 'family' },
    { sub: {}, sessionFamilyId: 'family' },
    { sub: 'owner', sessionFamilyId: {} },
    { sub: 'owner', sessionFamilyId: '' },
  ]) {
    const service = new SessionTokenService(
      {} as never,
      {
        verifyAsync: async () => ({ kind: 'browser', authVersion: 7, ...identifiers }),
      } as never,
      {} as never,
    );
    await assert.rejects(service.verifyAccessToken('synthetic'), /访问令牌类型无效/);
  }
});
