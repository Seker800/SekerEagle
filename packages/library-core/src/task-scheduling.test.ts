import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundScheduleAllows, nextBackgroundTime, mediaTaskFamily } from './task-scheduling';

test('one background schedule handles overnight windows and pause without affecting data', () => {
  const settings = { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00' };
  assert.equal(backgroundScheduleAllows(settings, new Date('2026-10-24T15:00:00Z')), true);
  assert.equal(backgroundScheduleAllows(settings, new Date('2026-10-24T22:00:00Z')), false);
  assert.equal(backgroundScheduleAllows({ ...settings, mode: 'MANUAL' }), false);
  assert.equal(backgroundScheduleAllows({ ...settings, mode: 'ALWAYS' }), true);
  assert.equal(
    nextBackgroundTime(settings, new Date('2026-10-24T04:00:00Z'))?.toISOString(),
    '2026-10-24T15:00:00.000Z',
  );
  assert.equal(nextBackgroundTime({ ...settings, mode: 'MANUAL' }), null);
});

test('same-day and equal boundaries use the same eligibility and next time', () => {
  const day = { mode: 'NIGHT', nightStart: '09:00', nightEnd: '12:00' };
  const noon = new Date('2026-10-24T04:00:00Z');
  assert.equal(backgroundScheduleAllows(day, noon), false);
  assert.equal(nextBackgroundTime(day, noon)?.toISOString(), '2026-10-25T01:00:00.000Z');
  assert.equal(backgroundScheduleAllows({ ...day, nightEnd: '09:00' }, noon), true);
  assert.equal(nextBackgroundTime({ ...day, mode: 'ALWAYS' }, noon)?.getTime(), noon.getTime());
  assert.equal(backgroundScheduleAllows({ ...day, mode: 'unknown' }, noon), false);
});

test('video playback and source details are separate from immediately needed browsing', () => {
  assert.equal(mediaTaskFamily('GENERATE_PREVIEW', 'video-playback-v1'), 'VIDEO');
  assert.equal(mediaTaskFamily('GENERATE_PREVIEW', 'photo-source-details-v1'), 'DETAILS');
  assert.equal(mediaTaskFamily('GENERATE_RENDITIONS', 'rendition-v2'), 'BROWSE');
  assert.equal(mediaTaskFamily('GENERATE_EMBEDDING', 'v1'), 'EMBEDDING');
  assert.equal(mediaTaskFamily('PURGE_ASSET', 'v1'), 'CLEANUP');
});

test('task sections explain actual execution without turning temporary waits into pauses', async () => {
  const { taskSection, taskExecutionPriority } = await import('./task-scheduling');
  const group = { id: 'EMBEDDING', background: true, queued: 5, running: 0, failed: 0, completed: 0, approval: 0, waiting: [], steps: [] } as const;
  const make = (extra = {}) => ({ ...group, waiting: [], steps: [], ...extra });
  const night = { mode: 'NIGHT', nightStart: '02:00', nightEnd: '10:00' };
  assert.equal(taskSection(make(), night), 'SCHEDULED');
  assert.equal(taskSection(make(), { ...night, mode: 'ALWAYS' }), 'IMMEDIATE');
  assert.equal(taskSection(make(), { ...night, mode: 'MANUAL' }), 'PAUSED');
  assert.equal(taskSection(make({ background: false, id: 'BROWSE' }), night), 'IMMEDIATE');
  assert.equal(taskSection(make({ availability: 'DISABLED', failed: 2, queued: 0 }), night), 'PAUSED');
  assert.equal(taskSection(make({ policy: { paused: true, priority: 1 } }), night), 'PAUSED');
  assert.equal(taskSection(make({ waiting: [{ reason: 'MODEL_OFFLINE', count: 5, nextAt: null }] }), night), 'SCHEDULED');
  assert.equal(taskSection(make({ id: 'APPROVALS', background: false }), night), 'REVIEW');
  assert.ok(taskExecutionPriority('COLOR') > taskExecutionPriority('EMBEDDING'));
  assert.ok(taskExecutionPriority('EMBEDDING') > taskExecutionPriority('DETAILS'));
  assert.ok(taskExecutionPriority('DETAILS') > taskExecutionPriority('PYRAMID'));
});
