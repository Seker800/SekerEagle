import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleTaskCenterController } from './eagle-task-center.controller';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

test('task center is available to authenticated browser owners and protects writes by Origin', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, EagleTaskCenterController), [AccessAuthGuard, BrowserPrincipalGuard]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, EagleTaskCenterController.prototype.settings), [BrowserOriginGuard]);
});

test('task center groups facts without returning raw errors, names or global worker load', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const service = new EagleTaskCenterService({
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return [{ family: 'BROWSE', step: 'GENERATE_RENDITIONS', status: 'QUEUED', reason: 'DEPENDENCY', count: 3n, nextAt: null }];
    },
    eagleProcessingWorkerHeartbeat: { findMany: async () => [{ capabilities: null }] },
    eagleProcessingSetting: { findUnique: async () => null },
  } as never, 'PHOTO');
  const result = await service.overview('owner-a', false);
  assert.equal(result.groups.find((group) => group.id === 'BROWSE')?.queued, 3);
  assert.equal(result.groups.find((group) => group.id === 'BROWSE')?.waiting[0]?.reason, 'DEPENDENCY');
  assert.equal(result.worker, 'ONLINE');
  assert.equal(queries.length, 1);
  assert.ok(queries[0]!.values.includes('owner-a'));
  assert.ok(queries[0]!.values.includes('PHOTO'));
  assert.ok(queries[0]!.values.includes(false));
  assert.match(queries[0]!.sql, /mediaRevision/);
  assert.match(queries[0]!.sql, /isPrivate/);
  assert.equal(JSON.stringify(result).includes('lastError'), false);
});

test('ordinary owners may change their own schedule, and DTO rejects malformed windows', async () => {
  const calls: unknown[] = [];
  const processing = { updateSettings: async (...args: unknown[]) => { calls.push(args); return {}; } };
  const controller = new EagleTaskCenterController({} as never, processing as never);
  const input = Object.assign(new UpdateEagleProcessingSettingsDto(), { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' });
  await controller.settings({ sub: 'owner-a' } as never, input);
  assert.deepEqual(calls, [['owner-a', input]]);
  assert.equal((await validate(input)).length, 0);
  input.nightStart = '26:00';
  assert.ok((await validate(input)).length > 0);
});
