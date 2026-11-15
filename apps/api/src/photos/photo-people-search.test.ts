import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('named people search stays inside the owner and applies the typed filter', async () => {
  let captured: Record<string, unknown> | undefined;
  const db = {
    eaglePhotoPerson: {
      findMany: async (args: Record<string, unknown>) => {
        captured = args;
        return [];
      },
    },
  };
  const service = new PhotoManagementService(db as never);
  await service.people('owner-a', false, undefined, 'NAMED', 'options', '  妈妈  ');
  const where = captured?.where as { ownerId?: string; name?: { contains?: string } };
  assert.equal(where.ownerId, 'owner-a');
  assert.equal(where.name?.contains, '妈妈');
  assert.equal(captured?.take, 25);
});
