import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setImmediate as flushQueryEvents } from 'node:timers/promises';
import { after, test } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { EagleAssetOperationService } from '../../apps/api/dist/eagle/eagle-asset-operations.service.js';
import { DATABASE_PARAMETER_LIMIT, DATABASE_STATEMENTS, databaseBatches, databaseBatchSize } from '../../apps/api/dist/eagle/eagle-database-batches.js';

assertSafeRuntimeTarget({ databaseUrl: process.env.DATABASE_URL ?? '', s3Endpoint: process.env.S3_ENDPOINT ?? '', s3Bucket: process.env.S3_BUCKET ?? '' });
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const events = [];
db.$on('query', ({ query, params }) => events.push({ query, parameters: JSON.parse(params).length }));
const owners = [];
const evidence = { statementBudgets: [], unknownKinds: [] };
const covered = new Set();
after(async () => {
  for (const ownerId of owners) {
    await db.eagleAssetOperation.deleteMany({ where: { ownerId } });
    await db.eagleAsset.deleteMany({ where: { ownerId } });
    await db.eagleManualTag.deleteMany({ where: { ownerId } });
    await db.eagleManualTagGroup.deleteMany({ where: { ownerId } });
    await db.eagleDuplicateGroup.deleteMany({ where: { ownerId } });
    await db.eagleDuplicateDismissal.deleteMany({ where: { ownerId } });
    await db.user.delete({ where: { id: ownerId } });
  }
  await db.$disconnect();
  mkdirSync('.omx/artifacts', { recursive: true });
  writeFileSync('.omx/artifacts/operation-protocol-db.json', JSON.stringify(evidence, null, 2) + '\n');
});
async function fixture(mode = 'MATERIAL') {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, passwordHash: 'synthetic-only' } });
  const asset = await db.eagleAsset.create({ data: {
    id: randomUUID(), ownerId, libraryMode: mode, originalName: 'synthetic.jpg', displayName: 'Synthetic', normalizedDisplayName: 'synthetic',
    mimeType: 'image/jpeg', format: 'jpeg', byteSize: 1, originalObjectKey: `users/${ownerId}/synthetic.jpg`, lifecycleStatus: 'READY', mediaRevision: 1,
  } });
  return { ownerId, mode, asset };
}
for (const mode of ['MATERIAL', 'PHOTO']) test(`${mode}: a persisted unknown kind fails without a resource transaction or asset write`, async () => {
  const { ownerId, asset } = await fixture(mode);
  const operation = await db.eagleAssetOperation.create({ data: {
    id: randomUUID(), ownerId, libraryMode: mode, kind: 'TRASH', inputIds: [asset.id], authVersion: 0, isPrivate: false,
    items: { create: { id: randomUUID(), ordinal: 0, assetIds: [asset.id], snapshots: [{ id: asset.id, rowVersion: asset.rowVersion, mediaRevision: asset.mediaRevision }], weight: 1, status: 'RUNNING', leaseUntil: new Date(Date.now()+120000), leaseVersion: 1 } },
  }, include: { items: { include: { operation: true } } } });
  // The DB check rejects malformed writes. Simulate version skew in an already persisted read
  // without changing constraints or touching another test's operation rows.
  await assert.rejects(db.eagleAssetOperation.update({ where: { id: operation.id }, data: { kind: 'FUTURE_KIND' } }));
  operation.items[0].operation.kind = 'FUTURE_KIND';
  const service = new EagleAssetOperationService(db, {}, {}, mode);
  service.logger = { error: () => undefined };
  await flushQueryEvents();
  const start = events.length;
  await service.execute(operation.items);
  await flushQueryEvents();
  const execution = events.slice(start);
  const mutations = execution.filter((event) => !/^(?:BEGIN|COMMIT|ROLLBACK)/.test(event.query.trim()));
  assert.equal(mutations.length, 1, 'only the terminal failure receipt is written');
  assert.ok(mutations[0].query.startsWith('UPDATE') && mutations[0].query.includes('EagleAssetOperationItem')); 
  assert.ok(!execution.some((event) => /(?:UPDATE|INSERT INTO|DELETE FROM) "(?:public"\.\")?EagleAsset"/.test(event.query)));
  const current = await db.eagleAsset.findUniqueOrThrow({ where: { id: asset.id } });
  assert.deepEqual(current, asset);
  const item = await db.eagleAssetOperationItem.findUniqueOrThrow({ where: { id: operation.items[0].id } });
  assert.equal(item.status, 'FAILED');
  assert.equal(item.errorCode, 'UNSUPPORTED_OPERATION_KIND');
  evidence.unknownKinds.push({ mode, resourceTransactions: 0, resourceWrites: 0, sql: execution.length, errorCode: item.errorCode });
});

/** Assert the actual Prisma statement, including generated defaults, never hides a second split. */
async function boundary(names, execute, row) {
  const budget = { ...DATABASE_STATEMENTS[names[0]], targetRows: DATABASE_PARAMETER_LIMIT };
  const size = databaseBatchSize(budget);
  const input = Array.from({ length: size + 1 }, (_, index) => row(index));
  let statementCount = 0;
  let maximumParameters = 0;
  for (const { rows } of databaseBatches(input, budget)) {
    await flushQueryEvents();
    const start = events.length;
    await execute(rows);
    await flushQueryEvents();
    const actual = events.slice(start).filter(({ query }) => !/^(?:BEGIN|COMMIT|ROLLBACK)/.test(query.trim()));
    assert.equal(actual.length, 1, `${names[0]} must fit one generated SQL statement per helper batch`);
    assert.ok(actual[0].parameters <= DATABASE_PARAMETER_LIMIT, names[0]);
    assert.ok(actual[0].parameters <= budget.fixedParameters + rows.length * budget.parametersPerRow, `${names[0]} must account for all generated binds`);
    statementCount += actual.length;
    maximumParameters = Math.max(maximumParameters, actual[0].parameters);
  }
  assert.equal(statementCount, 2);
  for (const name of names) {
    assert.equal(DATABASE_STATEMENTS[name].parametersPerRow, budget.parametersPerRow, name);
    assert.equal(DATABASE_STATEMENTS[name].fixedParameters, budget.fixedParameters, name);
    covered.add(name);
    evidence.statementBudgets.push({ name, rows: input.length, batchSize: size, sql: statementCount, maximumParameters, limit: DATABASE_PARAMETER_LIMIT });
  }
}

test('actual Prisma createMany binds fit every registered insert shape at the parameter boundary', async () => {
  const { ownerId, mode, asset } = await fixture();
  const scope = { ownerId, libraryMode: mode };
  const now = new Date();
  const operation = await db.eagleAssetOperation.create({ data: { ...scope, id: randomUUID(), kind: 'TRASH', inputIds: [], authVersion: 0, isPrivate: false } });
  await boundary(['operationItems', 'duplicateOperationItems', 'duplicateVerificationItems'],
    (rows) => db.eagleAssetOperationItem.createMany({ data: rows, skipDuplicates: true }),
    (ordinal) => ({ ...scope, id: randomUUID(), operationId: operation.id, ordinal, assetIds: [asset.id, asset.id], snapshots: [], weight: 2, status: 'PENDING', errorCode: null, leaseUntil: null, leaseVersion: 0, createdAt: now, updatedAt: now }));
  await boundary(['duplicateGroups'], (rows) => db.eagleDuplicateGroup.createMany({ data: rows, skipDuplicates: true }),
    (index) => ({ ...scope, signature: `budget-group-${index}`, algorithmVersion: 'synthetic', assetIds: [asset.id, asset.id], rowVersions: [1,1], mediaRevisions: [1,1], isPrivate: false, removableBytes: 1n }));
  await boundary(['duplicateIgnoreLookup'], (rows) => db.eagleDuplicateDismissal.createMany({ data: rows, skipDuplicates: true }),
    (index) => ({ ...scope, signature: createHash('sha256').update(`budget-ignore-${index}`).digest('hex'), createdAt: now }));
  const group = await db.eagleManualTagGroup.create({ data: { ...scope, name: 'budget', normalizedName: 'budget' } });
  const tag = await db.eagleManualTag.create({ data: { ...scope, name: 'budget', normalizedName: 'budget', groupId: group.id } });
  // Repeated composite keys intentionally exercise all binds without multiplying linked fixtures.
  await boundary(['transferTagGroupInsert'], (rows) => db.eagleManualTagGroup.createMany({ data: rows, skipDuplicates: true }),
    () => ({ ...scope, id: group.id, name: 'budget', normalizedName: 'budget', color: null, description: null, rowVersion: 1, createdAt: now, updatedAt: now }));
  await boundary(['transferTagInsert'], (rows) => db.eagleManualTag.createMany({ data: rows, skipDuplicates: true }),
    () => ({ ...scope, id: tag.id, name: 'budget', normalizedName: 'budget', color: null, groupId: group.id, isStarred: false, marksAssetsPrivate: false, lastUsedAt: null, rowVersion: 1, createdAt: now, updatedAt: now }));
  await boundary(['transferGroupMembershipInsert'], (rows) => db.eagleManualTagGroupMembership.createMany({ data: rows, skipDuplicates: true }),
    () => ({ ...scope, tagId: tag.id, groupId: group.id, createdAt: now }));
  await boundary(['duplicateTagInsert', 'transferAssetTagInsert'], (rows) => db.eagleAssetManualTag.createMany({ data: rows, skipDuplicates: true }),
    () => ({ ...scope, assetId: asset.id, tagId: tag.id, assignedByUser: true, assignmentProvenance: 'USER_ASSIGNED', acceptedSuggestionId: null, createdAt: now }));
});

test('actual expanded IN, restore OR, raw VALUES and array statements fit the registered bound', async () => {
  const { ownerId, mode } = await fixture();
  const scope = { ownerId, libraryMode: mode };
  await boundary(['operationAssetLookup', 'duplicateAssetLookup'],
    (rows) => db.eagleAsset.findMany({ where: { ...scope, id: { in: rows }, isPrivate: false, lifecycleStatus: 'READY', storageTransferredOut: false } }), (index) => `missing-${index}`);
  await boundary(['duplicateTagLookup'], (rows) => db.eagleAssetManualTag.findMany({ where: { ...scope, assetId: { in: rows } } }), (index) => `missing-${index}`);
  await boundary(['transferTagLookup'], (rows) => db.eagleManualTag.findMany({ where: { ...scope, normalizedName: { in: rows } } }), (index) => `missing-${index}`);
  await boundary(['duplicateVerificationLookup'], (rows) => db.eagleDuplicateFingerprint.findMany({ where: { ...scope, assetId: { in: rows }, pixelProcessorVersion: 'synthetic', pixelStatus: { in: ['VERIFIED','UNSUPPORTED','PIXEL_LIMIT'] } } }), (index) => `missing-${index}`);
  await boundary(['operationTrashTargets', 'duplicateTrashTargets'],
    (rows) => db.eagleAssetProcessingJob.updateMany({ where: { ...scope, OR: rows.flatMap((id) => [{ assetId: `${id}-still`, assetRevision: 1 },{ assetId: `${id}-motion`, assetRevision: 1 }]), status: 'COMPLETED', lastError: 'ASSET_TRASHED', kind: { not: 'PURGE_ASSET' } }, data: { status: 'PENDING' } }), (index) => `missing-${index}`);
  await boundary(['duplicateRestoreWhere', 'trashRestoreJobs'],
    (rows) => db.eagleAssetProcessingJob.updateMany({ where: { ...scope, OR: rows.map((assetId) => ({ assetId, assetRevision: 1 })), status: 'COMPLETED', lastError: 'ASSET_TRASHED', kind: { not: 'PURGE_ASSET' } }, data: { status: 'PENDING' } }), (index) => `missing-${index}`);
  await boundary(['trashAssetMutation'], (rows) => db.eagleAsset.updateMany({ where: { ...scope, id: { in: rows }, isPrivate: false, deletedAt: null }, data: { deletedAt: new Date(), rowVersion: { increment: 1 }, purgeAfter: null } }), (index) => `missing-${index}`);
  await boundary(['duplicateFingerprintPublish'], (rows) => db.$queryRaw`SELECT input.* FROM (VALUES ${Prisma.join(rows.map((id) => Prisma.sql`(${id},${1},${'hash'},${'[]'}::jsonb,${1}::float8)`))}) AS input(id, revision, hash, colors, contrast) WHERE ${ownerId}=${ownerId} AND ${mode}=${mode} AND ${'synthetic'}=${'synthetic'}`, (index) => `missing-${index}`);
  await boundary(['duplicateProofPublish'], (rows) => db.$queryRaw`SELECT input.* FROM (VALUES ${Prisma.join(rows.map((id) => Prisma.sql`(${id},${1}::int,${null}::text,${'UNSUPPORTED'})`))}) AS input(id, revision, hash, status) WHERE ${ownerId}=${ownerId} AND ${mode}=${mode}`, (index) => `missing-${index}`);
  // Whole arrays use one binding regardless of selection size, including 60k IDs.
  const ids = Array.from({ length: 60000 }, (_, index) => `missing-${index}`);
  const arrayBudget = { ...DATABASE_STATEMENTS.operationMembership, targetRows: ids.length };
  await flushQueryEvents();
  const start = events.length;
  for (const { rows } of databaseBatches(ids, arrayBudget))
    await db.$queryRaw`SELECT requested.id FROM unnest(${rows}::text[]) AS requested(id) WHERE ${ownerId}=${mode} OR ${false}`;
  await flushQueryEvents();
  const actual = events.slice(start);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].parameters, 4);
  covered.add('operationMembership');
  evidence.statementBudgets.push({ name: 'operationMembership', rows: ids.length, sql: 1, maximumParameters: 4, limit: DATABASE_PARAMETER_LIMIT });
  assert.deepEqual([...covered].sort(), Object.keys(DATABASE_STATEMENTS).sort(), 'new statement registrations require a real database shape boundary case');
});
