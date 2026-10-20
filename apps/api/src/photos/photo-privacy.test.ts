import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotoManagementService } from './photo-management.service';
test('人物隐私拥有服务端规则入口', () => {
  assert.equal(
    typeof PhotoManagementService.prototype['setPersonPrivacy' as keyof PhotoManagementService],
    'function',
  );
});

test('stale person edits are rejected before changing rules or asset visibility', async () => {
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async () => ({ id: 'person', rowVersion: 4 }),
      update: async () => {
        throw new Error('unexpected person write');
      },
    },
  };
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  } as never);
  await assert.rejects(service.setPersonPrivacy('owner', 'person', true, 3, false), /变化/);
});
test('missing or invisible people cannot change privacy', async () => {
  let query: unknown;
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async (input: unknown) => {
        query = input;
        return null;
      },
    },
  };
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  } as never);
  await assert.rejects(service.setPersonPrivacy('owner', 'foreign', false, 1, false), /不存在/);
  assert.match(JSON.stringify(query), /"ownerId":"owner"/);
  assert.match(JSON.stringify(query), /"marksAssetsPrivate":false/);
});
