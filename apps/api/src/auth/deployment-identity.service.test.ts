import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaService } from '../prisma/prisma.service';
import { DeploymentIdentityService } from './deployment-identity.service';

test('creates one persistent random deployment identity and memoizes database access', async () => {
  let calls = 0;
  const prisma = {
    appDeploymentIdentity: {
      async upsert(input: { create: { value: string } }) {
        calls += 1;
        assert.match(input.create.value, /^[0-9a-f]{64}$/u);
        return { value: 'd'.repeat(64) };
      },
    },
  } as unknown as PrismaService;
  const service = new DeploymentIdentityService(prisma);

  assert.equal(await service.get(), 'd'.repeat(64));
  assert.equal(await service.get(), 'd'.repeat(64));
  assert.equal(calls, 1);
});
