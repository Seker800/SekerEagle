import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleTaskCenterController, TaskPolicyDto } from './eagle-task-center.controller';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

test('task center is available to authenticated browser owners and protects writes by Origin', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, EagleTaskCenterController), [
    AccessAuthGuard,
    BrowserPrincipalGuard,
  ]);
  const settings = Reflect.getOwnPropertyDescriptor(
    EagleTaskCenterController.prototype,
    'settings',
  )?.value;
  assert.ok(settings);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, settings), [BrowserOriginGuard]);
});

test('task center groups facts without returning raw errors, names or global worker load', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const service = new EagleTaskCenterService(
    {
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        return [
          {
            family: 'BROWSE',
            step: 'GENERATE_RENDITIONS',
            status: 'QUEUED',
            reason: 'DEPENDENCY',
            count: 3n,
            nextAt: null,
          },
        ];
      },
      eagleProcessingWorkerHeartbeat: { findMany: async () => [{ capabilities: null }] },
      eagleProcessingSetting: { findUnique: async () => null },
      eagleTaskPolicy: { findMany: async () => [] },
    } as never,
    'PHOTO',
  );
  const result = await service.overview('owner-a', false);
  assert.equal(result.groups.find((group) => group.id === 'BROWSE')?.queued, 3);
  assert.equal(
    result.groups.find((group) => group.id === 'BROWSE')?.waiting[0]?.reason,
    'DEPENDENCY',
  );
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
  const processing = {
    updateSettings: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  };
  const controller = new EagleTaskCenterController({} as never, processing as never);
  const input = Object.assign(new UpdateEagleProcessingSettingsDto(), {
    mode: 'ALWAYS',
    nightStart: '23:00',
    nightEnd: '06:00',
  });
  await controller.settings({ sub: 'owner-a' } as never, input);
  assert.deepEqual(calls, [['owner-a', input]]);
  assert.equal((await validate(input)).length, 0);
  input.nightStart = '26:00';
  assert.ok((await validate(input)).length > 0);
});

test('per-work pause and priority settings are bound to the authenticated owner and fixed mode', async () => {
  let write: unknown;
  const service = new EagleTaskCenterService(
    {
      eagleTaskPolicy: {
        upsert: async (input: unknown) => {
          write = input;
          return {};
        },
      },
    } as never,
    'PHOTO',
  );
  await service.policy('owner-a', { family: 'EMBEDDING', paused: true, priority: 1 });
  assert.deepEqual((write as { where: unknown }).where, {
    ownerId_libraryMode_family: { ownerId: 'owner-a', libraryMode: 'PHOTO', family: 'EMBEDDING' },
  });
});

test('waiting reasons reflect policy, deployment, dependencies and model availability independently', async () => {
  const capabilities = {
    background: true,
    jobKinds: null,
    video: true,
    tagBuilds: true,
    smartFolders: true,
    photoMap: true,
    embedding: 'READY',
  };
  const row = {
    family: 'MEDIA',
    step: 'GENERATE_EMBEDDING',
    version: 'v1',
    status: 'QUEUED',
    reason: 'QUEUED',
    count: 2n,
    nextAt: new Date(Date.now() + 60000),
  };
  const cases = [
    { expected: 'QUEUED' },
    { workers: [], expected: 'WORKER_OFFLINE' },
    { capability: { ...capabilities, background: false }, expected: 'DISABLED' },
    { capability: { ...capabilities, jobKinds: [] }, expected: 'DISABLED' },
    { capability: { ...capabilities, embedding: 'OFFLINE' }, expected: 'MODEL_OFFLINE' },
    { capability: { ...capabilities, embedding: 'DRIFTED' }, expected: 'MODEL_DRIFTED' },
    { mode: 'MANUAL', expected: 'PAUSED' },
    { policy: { family: 'EMBEDDING', paused: true, priority: 1 }, expected: 'PAUSED' },
    { reason: 'DEPENDENCY', expected: 'DEPENDENCY' },
    { reason: 'DEPENDENCY_FAILED', expected: 'DEPENDENCY_FAILED' },
    { reason: 'RETRY', expected: 'RETRY' },
  ];
  for (const item of cases) {
    const service = new EagleTaskCenterService({
      $queryRaw: async () => [{ ...row, reason: 'reason' in item ? item.reason : row.reason }],
      eagleProcessingWorkerHeartbeat: {
        findMany: async () =>
          'workers' in item
            ? item.workers
            : [{ capabilities: 'capability' in item ? item.capability : capabilities }],
      },
      eagleProcessingSetting: {
        findUnique: async () => ({
          mode: 'mode' in item ? item.mode : 'ALWAYS',
          nightStart: '23:00',
          nightEnd: '06:00',
        }),
      },
      eagleTaskPolicy: { findMany: async () => ('policy' in item ? [item.policy] : []) },
    } as never);
    assert.equal((await service.overview('owner')).groups[0]?.waiting[0]?.reason, item.expected);
  }
});

test('overview merges steps and distinguishes completed work, failures and human decisions', async () => {
  const service = new EagleTaskCenterService({
    $queryRaw: async () => [
      ...['QUEUED', 'QUEUED', 'RUNNING', 'FAILED', 'COMPLETED'].map((status) => ({
        family: 'BROWSE',
        step: 'GENERATE_RENDITIONS',
        status,
        reason: 'QUEUED',
        count: 1n,
        nextAt: null,
      })),
      {
        family: 'APPROVALS',
        step: 'APPROVALS',
        status: 'APPROVAL',
        reason: 'APPROVAL',
        count: 2n,
        nextAt: null,
      },
    ],
    eagleProcessingWorkerHeartbeat: { findMany: async () => [{ capabilities: null }] },
    eagleProcessingSetting: { findUnique: async () => null },
    eagleTaskPolicy: { findMany: async () => [] },
  } as never);
  const result = await service.overview('owner');
  const browse = result.groups.find((entry) => entry.id === 'BROWSE');
  assert.equal(browse?.queued, 2);
  assert.equal(browse?.running, 1);
  assert.equal(browse?.failed, 1);
  assert.equal(browse?.completed, 1);
  assert.equal(browse?.steps.length, 1);
  assert.equal(result.groups.find((entry) => entry.id === 'APPROVALS')?.approval, 2);
});

test('retry preserves saved indexing progress and only resets failed work in its own category', async () => {
  const writes: Array<{
    target: string;
    input: { where: { status: string }; data: Record<string, unknown> };
  }> = [];
  const service = new EagleTaskCenterService({
    $transaction: async (action: (tx: unknown) => unknown) =>
      action({
        $queryRaw: async (query: { sql: string }) =>
          query.sql.includes('pg_advisory') ? [] : [{ count: 2n }],
        eagleSmartFolderSemanticSnapshot: {
          updateMany: async (input: never) => {
            writes.push({ target: 'folder', input });
            return { count: 1 };
          },
        },
        eagleTagSemanticBuild: {
          updateMany: async (input: never) => {
            writes.push({ target: 'tag', input });
            return { count: 1 };
          },
        },
      }),
  } as never);
  assert.deepEqual(await service.retry('owner', 'SMART_FOLDERS'), { retried: 1 });
  assert.deepEqual(await service.retry('owner', 'TAG_INDEX', true), { retried: 1 });
  for (const write of writes) {
    assert.equal(write.input.where.status, 'FAILED');
    assert.equal('cursor' in write.input.data, false);
    assert.equal('scannedCount' in write.input.data, false);
  }
  for (const family of ['BROWSE', 'DETAILS', 'VIDEO', 'EMBEDDING'] as const)
    assert.deepEqual(await service.retry('owner', family), { retried: 2 });
  for (const family of ['APPROVALS', 'CLEANUP', 'UPLOADS', 'IMPORTS', 'PHOTO_MAP'] as const)
    await assert.rejects(service.retry('owner', family), { status: 404 });
});

test('schedule explanations use the actual intersection and deployment-specific capabilities', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T04:00:00Z') });
  const cap = {
    background: true,
    jobKinds: null,
    video: true,
    smartFolders: true,
    tagBuilds: true,
    photoMap: true,
  };
  const overview = async (family: string, setting: unknown, capabilities: unknown) => {
    const service = new EagleTaskCenterService({
      $queryRaw: async () => [
        {
          family,
          step: family,
          version: 'v1',
          status: 'QUEUED',
          reason: 'QUEUED',
          count: 1n,
          nextAt: null,
        },
      ],
      eagleProcessingWorkerHeartbeat: { findMany: async () => [{ capabilities }] },
      eagleProcessingSetting: { findUnique: async () => setting },
      eagleTaskPolicy: { findMany: async () => [] },
    } as never);
    return (await service.overview('owner')).groups[0]?.waiting[0];
  };
  const night = { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00' };
  assert.equal((await overview('EMBEDDING', night, cap))?.reason, 'SCHEDULE');
  assert.equal(await overview('AI_TAGS', { mode: 'ALWAYS' }, cap), undefined);
  for (const [family, field] of [
    ['VIDEO', 'video'],
    ['SMART_FOLDERS', 'smartFolders'],
    ['TAG_INDEX', 'tagBuilds'],
    ['PHOTO_MAP', 'photoMap'],
  ])
    assert.equal(
      (await overview(family!, { mode: 'ALWAYS' }, { ...cap, [field!]: false }))?.reason,
      'DISABLED',
    );
});

test('indexes that only use saved vectors do not wait for the inference host', async () => {
  const service = new EagleTaskCenterService({
    $queryRaw: async () =>
      ['TAG_INDEX', 'SMART_FOLDERS'].map((family) => ({
        family,
        step: family,
        version: '',
        status: 'QUEUED',
        reason: 'QUEUED',
        count: 1n,
        nextAt: null,
      })),
    eagleProcessingWorkerHeartbeat: {
      findMany: async () => [
        {
          capabilities: {
            background: true,
            jobKinds: null,
            tagBuilds: true,
            smartFolders: true,
            embedding: 'OFFLINE',
          },
        },
      ],
    },
    eagleProcessingSetting: {
      findUnique: async () => ({ mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' }),
    },
    eagleTaskPolicy: { findMany: async () => [] },
  } as never);
  const result = await service.overview('owner');
  for (const group of result.groups) assert.equal(group.waiting[0]?.reason, 'QUEUED');
});

test('disabled capability is reported even if every task is failed and has no wait bucket', async () => {
  const service = new EagleTaskCenterService({
    $queryRaw: async () => [
      {
        family: 'MEDIA',
        step: 'EXTRACT_COLOR_PALETTE',
        version: 'v1',
        status: 'FAILED',
        reason: 'QUEUED',
        count: 6n,
      },
    ],
    eagleProcessingWorkerHeartbeat: {
      findMany: async () => [
        { capabilities: { background: true, jobKinds: ['GENERATE_RENDITIONS'] } },
      ],
    },
    eagleProcessingSetting: { findUnique: async () => ({ mode: 'ALWAYS' }) },
    eagleTaskPolicy: { findMany: async () => [] },
  } as never);
  assert.equal((await service.overview('owner')).groups[0]?.availability, 'DISABLED');
});

test('pause needs no user priority, and historical priority cannot override automatic rules', async () => {
  assert.equal(
    (await validate(Object.assign(new TaskPolicyDto(), { family: 'EMBEDDING', paused: true })))
      .length,
    0,
  );
  let write: { create: { priority: number }; update: { priority: number } } | undefined;
  const service = new EagleTaskCenterService({
    eagleTaskPolicy: {
      upsert: async (input: typeof write) => {
        write = input;
        return {};
      },
    },
  } as never);
  await service.policy('owner', { family: 'EMBEDDING', paused: true, priority: 1 });
  assert.equal(write?.create.priority, 0);
  assert.equal(write?.update.priority, 0);
});

test('reports embedding health even when every vector task is already processing', async () => {
  for (const [states, expected] of [
    [['OFFLINE'], 'OFFLINE'],
    [['DRIFTED'], 'DRIFTED'],
    [['OFFLINE', 'READY'], 'READY'],
    [[], 'UNKNOWN'],
  ] as const) {
    const service = new EagleTaskCenterService(
      {
        $queryRaw: async () => [
          {
            family: 'MEDIA',
            step: 'GENERATE_EMBEDDING',
            version: 'v1',
            status: 'RUNNING',
            reason: 'QUEUED',
            count: 2n,
            nextAt: null,
          },
        ],
        eagleProcessingWorkerHeartbeat: {
          findMany: async () =>
            states.map((embedding) => ({
              capabilities: { background: true, jobKinds: null, embedding },
            })),
        },
        eagleProcessingSetting: { findUnique: async () => ({ mode: 'ALWAYS' }) },
        eagleTaskPolicy: { findMany: async () => [] },
      } as never,
      'PHOTO',
    );
    const result = await service.overview('owner-a');
    assert.equal((result as { embedding?: string }).embedding, expected);
    assert.equal(result.groups[0]?.running, 2);
  }
});

test('API publishes authoritative state without confusing partially blocked groups with stalled groups', async () => {
  const service = new EagleTaskCenterService(
    {
      $queryRaw: async () => [
        {
          family: 'MEDIA',
          step: 'GENERATE_EMBEDDING',
          version: 'v1',
          status: 'QUEUED',
          reason: 'QUEUED',
          count: 3n,
          nextAt: null,
        },
      ],
      eagleProcessingWorkerHeartbeat: {
        findMany: async () => [
          {
            capabilities: {
              background: true,
              jobKinds: ['GENERATE_EMBEDDING'],
              video: false,
              tagBuilds: false,
              smartFolders: false,
              photoMap: false,
              embedding: 'OFFLINE',
            },
          },
        ],
      },
      eagleProcessingSetting: { findUnique: async () => ({ mode: 'ALWAYS' }) },
      eagleTaskPolicy: { findMany: async () => [] },
    } as never,
    'PHOTO',
  );
  const result = await service.overview('owner-a');
  assert.deepEqual((result.groups[0] as unknown as { presentation: unknown }).presentation, {
    status: 'WAITING',
    section: 'IMMEDIATE',
    reason: 'MODEL_OFFLINE',
  });
});

test('live polling excludes completed history before aggregating media jobs', async () => {
  const { taskCenterQuery } = await import('./task-center-query');
  assert.match(taskCenterQuery('owner-a', 'PHOTO', false).sql, /AND j\.status<>'COMPLETED'/);
});

test('transition history is bounded, current-version and private/owner/mode scoped', async () => {
  let captured: { sql: string; values: unknown[] } | undefined;
  const service = new EagleTaskCenterService(
    {
      $queryRaw: async (query: { sql: string; values: unknown[] }) => {
        captured = query;
        return [];
      },
    } as never,
    'PHOTO',
  );
  assert.deepEqual(await service.events('owner-a', 'EMBEDDING', false), []);
  assert.ok(captured?.values.includes('owner-a'));
  assert.ok(captured?.values.includes('PHOTO'));
  assert.ok(captured?.values.includes(false));
  assert.match(captured!.sql, /mediaRevision/);
  assert.match(captured!.sql, /LIMIT 30/);
  assert.doesNotMatch(captured!.sql, /lastError/);
});

test('lost worker heartbeat is visible before long execution leases expire', async () => {
  const service = new EagleTaskCenterService({
    $queryRaw: async () => [
      {
        family: 'MEDIA',
        step: 'GENERATE_RENDITIONS',
        version: 'v1',
        status: 'RUNNING',
        reason: 'QUEUED',
        count: 1n,
        nextAt: null,
      },
    ],
    eagleProcessingWorkerHeartbeat: { findMany: async () => [] },
    eagleProcessingSetting: { findUnique: async () => ({ mode: 'ALWAYS' }) },
    eagleTaskPolicy: { findMany: async () => [] },
  } as never);
  const result = await service.overview('owner-a');
  assert.equal(result.groups[0]?.running, 1); // A lease is not silently erased.
  assert.equal(result.groups[0]?.presentation?.status, 'WAITING');
  assert.equal(result.groups[0]?.presentation?.reason, 'WORKER_OFFLINE');
});

test('overview carries the latest visible source activity and authoritative management decisions', async () => {
  const service = new EagleTaskCenterService(
    {
      $queryRaw: async () => [
        {
          family: 'MEDIA',
          step: 'GENERATE_EMBEDDING',
          version: 'v1',
          status: 'QUEUED',
          reason: 'QUEUED',
          count: 1n,
          nextAt: null,
          lastActivityAt: new Date('2026-10-26T01:00:00Z'),
        },
      ],
      eagleProcessingWorkerHeartbeat: { findMany: async () => [] },
      eagleProcessingSetting: { findUnique: async () => ({ mode: 'ALWAYS' }) },
      eagleTaskPolicy: { findMany: async () => [] },
    } as never,
    'PHOTO',
  );
  const result = await service.overview('owner');
  assert.equal(result.groups[0]?.lastActivityAt, '2026-10-26T01:00:00.000Z');
  assert.equal(result.groups[0]?.management?.execution, 'ALWAYS');
});

for (const faces of [true, false])
  test(`photo task center computes scan availability before any face job exists: ${faces}`, async () => {
    const service = new EagleTaskCenterService(
      {
        $queryRaw: async () => [
          {
            family: 'FACES',
            step: 'ANALYZE_PHOTO_FACES',
            version: 'v1',
            status: 'UNSCANNED',
            reason: 'QUEUED',
            count: 1201n,
            nextAt: null,
          },
        ],
        eagleProcessingWorkerHeartbeat: {
          findMany: async () => [{ capabilities: { background: true, jobKinds: null, faces } }],
        },
        eagleProcessingSetting: { findUnique: async () => null },
        eagleTaskPolicy: { findMany: async () => [] },
      } as never,
      'PHOTO',
    );
    const result = await service.overview('owner', false);
    const face = result.groups.find((group) => group.id === 'FACES');
    assert.equal(face?.unscanned, 1201);
    assert.equal(face?.availability, faces ? 'ENABLED' : 'DISABLED');
    assert.equal(face?.management?.canStart, faces);
    assert.equal(face?.presentation?.status, 'UNSCANNED');
    assert.equal(face?.queued, 0);
    assert.equal(face?.completed, 0);
  });

test('scan start derives owner and private visibility from principal and requires browser Origin', async () => {
  const { StartTaskFamilyDto } = await import('./eagle-task-center.controller');
  const calls: unknown[] = [];
  const controller = new EagleTaskCenterController(
    {
      start: async (...args: unknown[]) => {
        calls.push(args);
        return { queued: 0 };
      },
    } as never,
    {} as never,
  );
  const { StartTaskFamilyDto: StartDto } = await import('./eagle-task-center.controller');
  assert.ok(
    (
      await validate(Object.assign(new StartDto(), { family: 'FACES', ownerId: 'other' }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).length,
  );
  const handler = Object.getOwnPropertyDescriptor(EagleTaskCenterController.prototype, 'start')!
    .value as object;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOriginGuard]);
  await controller.start({ sub: 'owner-a', canViewPrivate: false } as never, { family: 'FACES' });
  assert.deepEqual(calls, [['owner-a', 'FACES', false]]);
  assert.equal(
    (await validate(Object.assign(new StartTaskFamilyDto(), { family: 'FACES' }))).length,
    0,
  );
  assert.ok(
    (await validate(Object.assign(new StartTaskFamilyDto(), { family: 'EMBEDDING' }))).length,
  );
});

test('scan start refuses material mode, unsupported families and unconfigured runtime without writes', async () => {
  for (const [mode, family] of [
    ['MATERIAL', 'FACES'],
    ['PHOTO', 'COLOR'],
  ] as const) {
    await assert.rejects(new EagleTaskCenterService({} as never, mode).start('owner', family), {
      status: 404,
    });
  }
  const previous = process.env.PHOTO_FACE_PYTHON;
  delete process.env.PHOTO_FACE_PYTHON;
  try {
    await assert.rejects(new EagleTaskCenterService({} as never, 'PHOTO').start('owner', 'FACES'), {
      status: 400,
    });
  } finally {
    if (previous !== undefined) process.env.PHOTO_FACE_PYTHON = previous;
  }
});

test('missing face runtime disables face execution without hiding unscanned coverage', async () => {
  const service = new EagleTaskCenterService(
    {
      $queryRaw: async () => [
        {
          family: 'FACES',
          step: 'ANALYZE_PHOTO_FACES',
          version: 'v1',
          status: 'UNSCANNED',
          reason: 'QUEUED',
          count: 2n,
          nextAt: null,
        },
      ],
      eagleProcessingWorkerHeartbeat: {
        findMany: async () => [
          { capabilities: { background: true, jobKinds: null, faces: false } },
        ],
      },
      eagleProcessingSetting: { findUnique: async () => null },
      eagleTaskPolicy: { findMany: async () => [] },
    } as never,
    'PHOTO',
  );
  const group = (await service.overview('owner')).groups[0]!;
  assert.equal(group.availability, 'DISABLED');
  assert.equal(group.unscanned, 2);
});

test('only admin task overview exposes sanitized machine capacity', async () => {
  const compute = {
    revision: 2,
    backgroundLimit: 2,
    nodes: [
      {
        id: 'mac',
        name: 'Mac',
        accelerator: 'metal',
        enabled: true,
        health: 'READY',
        concurrency: 2,
        inFlight: 1,
        operations: ['embedding'],
        token: 'do-not-leak',
        url: 'private-address',
      },
    ],
  };
  const service = new EagleTaskCenterService({
    $queryRaw: async () => [],
    eagleProcessingWorkerHeartbeat: { findMany: async () => [{ capabilities: { compute } }] },
    eagleProcessingSetting: { findUnique: async () => null },
    eagleTaskPolicy: { findMany: async () => [] },
  } as never);
  assert.equal((await service.overview('owner', false)).compute, undefined);
  const admin = await service.overview('owner', false, 'ACTIVE', true);
  assert.equal(admin.compute?.nodes[0]?.name, 'Mac');
  assert.ok(!JSON.stringify(admin).includes('do-not-leak'));
  assert.ok(!JSON.stringify(admin).includes('private-address'));
});

test('controller includes fleet summary only for an administrator active overview', () => {
  const calls: unknown[][] = [];
  const controller = new EagleTaskCenterController(
    {
      overview: (...args: unknown[]) => calls.push(args),
    } as never,
    {} as never,
  );
  for (const role of ['ADMIN', 'USER'] as const) {
    const principal = { sub: 'owner', canViewPrivate: false, role } as Parameters<
      typeof controller.overview
    >[0];
    controller.overview(principal);
    controller.history(principal);
  }
  assert.deepEqual(calls, [
    ['owner', false, 'ACTIVE', true],
    ['owner', false, 'HISTORY'],
    ['owner', false, 'ACTIVE', false],
    ['owner', false, 'HISTORY'],
  ]);
});
