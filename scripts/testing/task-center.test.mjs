import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { backgroundScheduleAllows } from '../../packages/library-core/dist/index.js';
import { backgroundScheduleSql } from '../../packages/library-persistence/dist/index.js';
import { EagleTaskCenterService } from '../../apps/api/dist/eagle/eagle-task-center.service.js';
import { runSmartFolderBuildStep } from '../../apps/worker/dist/smart-folder-build.js';
import { claimNextScheduledTagBuild } from '../../apps/worker/dist/tag-build-lease.js';
import { selectScheduledMediaCandidates } from '../../apps/worker/dist/scheduled-media-candidates.js';
import { buildMediaWakeQuery } from '../../apps/worker/dist/job-wakeup-query.js';

assertSafeRuntimeTarget({ databaseUrl: process.env.DATABASE_URL, s3Endpoint: process.env.S3_ENDPOINT, s3Bucket: process.env.S3_BUCKET });
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sekereagle_test');
const prisma = new PrismaClient();
after(() => prisma.$disconnect());
async function fixture() {
  const owner = randomUUID(), other = randomUUID();
  await prisma.user.createMany({ data: [owner, other].map((id) => ({ id, email: `${id}@example.invalid`, passwordHash: 'synthetic-only' })) });
  const asset = (options = {}) => prisma.eagleAsset.create({ data: { ownerId: owner, libraryMode: 'PHOTO', originalName: 'synthetic.jpg', displayName: 'Synthetic', normalizedDisplayName: 'synthetic', mimeType: 'image/jpeg', format: 'jpeg', byteSize: 1, mediaRevision: 2, originalObjectKey: `users/${owner}/assets/${randomUUID()}/original.jpg`, ...options } });
  const job = (a, options = {}) => prisma.eagleAssetProcessingJob.create({ data: { ownerId: a.ownerId, libraryMode: a.libraryMode, assetId: a.id, assetRevision: a.mediaRevision, kind: 'GENERATE_EMBEDDING', lane: 'BACKGROUND', ...options } });
  return { owner, other, asset, job, service: new EagleTaskCenterService(prisma, 'PHOTO') };
}

test('task overview uses current visible resources and never crosses owner or mode', async () => {
  const f = await fixture();
  await f.job(await f.asset());
  await f.job(await f.asset({ isPrivate: true }));
  await f.job(await f.asset({ ownerId: f.other }));
  await f.job(await f.asset({ libraryMode: 'MATERIAL' }));
  await f.job(await f.asset(), { assetRevision: 1 });
  await f.job(await f.asset({ deletedAt: new Date() }));
  assert.equal((await f.service.overview(f.owner)).groups.find((g) => g.id === 'EMBEDDING').queued, 1);
  assert.equal((await f.service.overview(f.owner, true)).groups.find((g) => g.id === 'EMBEDDING').queued, 2);
  assert.equal((await new EagleTaskCenterService(prisma).overview(f.owner)).groups.find((g) => g.id === 'EMBEDDING').queued, 1);
});

test('family retry fences privacy, ownership, mode and media version and keeps optional analysis from blocking browsing', async () => {
  const f = await fixture();
  const a = await f.asset({ lifecycleStatus: 'READY' });
  const visible = await f.job(a, { status: 'FAILED', attempts: 5 });
  const hidden = await f.job(await f.asset({ isPrivate: true }), { status: 'FAILED' });
  const foreign = await f.job(await f.asset({ ownerId: f.other }), { status: 'FAILED' });
  const material = await f.job(await f.asset({ libraryMode: 'MATERIAL' }), { status: 'FAILED' });
  const obsolete = await f.job(await f.asset(), { assetRevision: 1, status: 'FAILED' });
  assert.deepEqual(await f.service.retry(f.owner, 'EMBEDDING'), { retried: 1 });
  assert.equal((await prisma.eagleAssetProcessingJob.findUnique({ where: { id: visible.id } })).status, 'PENDING');
  for (const row of [hidden, foreign, material, obsolete]) assert.equal((await prisma.eagleAssetProcessingJob.findUnique({ where: { id: row.id } })).status, 'FAILED');
  assert.equal((await prisma.eagleAsset.findUnique({ where: { id: a.id } })).lifecycleStatus, 'READY');
  await assert.rejects(f.service.retry(f.other, 'VIDEO'), { status: 404 });
});

test('database scheduling agrees with shared rules and pausing preserves snapshot progress', async () => {
  const f = await fixture();
  for (const schedule of [{ mode: 'MANUAL', nightStart: '23:00', nightEnd: '06:00' }, { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' }, { mode: 'NIGHT', nightStart: '09:00', nightEnd: '12:00' }, { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00' }, { mode: 'NIGHT', nightStart: '01:00', nightEnd: '01:00' }]) {
    await prisma.eagleProcessingSetting.upsert({ where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } }, create: { ownerId: f.owner, libraryMode: 'PHOTO', ...schedule }, update: schedule });
    const [row] = await prisma.$queryRaw(Prisma.sql`SELECT now() AS at, ${backgroundScheduleSql(Prisma.sql`${f.owner}`, Prisma.sql`'PHOTO'::"LibraryMode"`)} AS allowed`);
    assert.equal(row.allowed, backgroundScheduleAllows(schedule, row.at));
  }
  await prisma.eagleProcessingSetting.update({ where: { ownerId_libraryMode: { ownerId: f.owner, libraryMode: 'PHOTO' } }, data: { mode: 'MANUAL' } });
  const folder = await prisma.eagleSmartFolder.create({ data: { ownerId: f.owner, libraryMode: 'PHOTO', name: 'Synthetic', normalizedName: randomUUID(), queryJson: {} } });
  const snapshot = await prisma.eagleSmartFolderSemanticSnapshot.create({ data: { ownerId: f.owner, libraryMode: 'PHOTO', folderId: folder.id, intentKey: randomUUID(), text: 'Synthetic', breadth: 'BALANCED', threshold: 0.5, spaceId: `test-${randomUUID()}`, scannedCount: 500, cursor: 'synthetic-cursor' } });
  let embeds = 0;
  await runSmartFolderBuildStep(prisma, snapshot.spaceId, async () => { embeds++; return { embedding: [] }; });
  assert.equal(embeds, 0);
  const retained = await prisma.eagleSmartFolderSemanticSnapshot.findUnique({ where: { id: snapshot.id } });
  assert.equal(retained.cursor, 'synthetic-cursor'); assert.equal(retained.scannedCount, 500); assert.equal(retained.attempts, 0);
});

test('scheduled tag claims skip paused owners without consuming their attempts', async () => {
  const f = await fixture();
  for (const [ownerId, mode] of [[f.owner, 'MANUAL'], [f.other, 'ALWAYS']]) {
    await prisma.eagleProcessingSetting.create({ data: { ownerId, libraryMode: 'PHOTO', mode } });
    const tag = await prisma.eagleManualTag.create({ data: { ownerId, libraryMode: 'PHOTO', name: 'Synthetic', normalizedName: randomUUID() } });
    await prisma.eagleTagSemanticBuild.create({ data: { ownerId, libraryMode: 'PHOTO', tagId: tag.id, availableAt: new Date('1900-01-01T00:00:00Z') } });
  }
  const build = await claimNextScheduledTagBuild(prisma);
  assert.equal(build.ownerId, f.other);
  assert.equal((await prisma.eagleTagSemanticBuild.findFirst({ where: { ownerId: f.owner } })).attempts, 0);
});

test('per-category pause is applied before the candidate limit and priority leaves FIFO turns available', async () => {
  const f = await fixture();
  await prisma.eagleProcessingSetting.create({ data: { ownerId: f.owner, libraryMode: 'PHOTO', mode: 'ALWAYS' } });
  const normal = await f.job(await f.asset(), { availableAt: new Date('1900-01-01T00:00:00Z') });
  const urgent = await f.job(await f.asset(), { kind: 'EXTRACT_COLOR_PALETTE', availableAt: new Date('1900-01-02T00:00:00Z') });
  await f.service.policy(f.owner, { family: 'COLOR', paused: false, priority: 1 });
  const query = { where: { lane: 'BACKGROUND', kind: { not: 'GENERATE_AI_TAGS' } }, take: 50 };
  assert.equal((await selectScheduledMediaCandidates(prisma, query, true))[0].id, urgent.id);
  assert.equal((await selectScheduledMediaCandidates(prisma, query, false))[0].id, normal.id);
  await f.service.policy(f.owner, { family: 'COLOR', paused: true, priority: 1 });
  assert.ok(!(await selectScheduledMediaCandidates(prisma, query)).some((row) => row.id === urgent.id));
  assert.equal((await prisma.eagleAssetProcessingJob.findUnique({ where: { id: urgent.id } })).attempts, 0);
  const wakes = await prisma.$queryRaw(buildMediaWakeQuery());
  assert.ok(!wakes.some((row) => row.ownerId === f.owner && row.kind === 'EXTRACT_COLOR_PALETTE'));
  const material = await new EagleTaskCenterService(prisma, 'MATERIAL').overview(f.owner);
  assert.ok(!material.groups.some((group) => group.policy?.paused));
});
