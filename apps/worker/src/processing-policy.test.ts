import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canClaimBackgroundJobs,
  processingLaneForKind,
  taskBlocksAssetReady,
} from './processing-policy';

test('classifies current and future processing jobs into stable lanes', () => {
  assert.equal(processingLaneForKind('GENERATE_RENDITIONS'), 'INTERACTIVE');
  assert.equal(processingLaneForKind('GENERATE_THUMBNAIL'), 'INTERACTIVE');
  assert.equal(processingLaneForKind('EXTRACT_COLOR_PALETTE'), 'BACKGROUND');
  assert.equal(processingLaneForKind('PURGE_ASSET'), 'MAINTENANCE');
});

test('only required media jobs block the asset ready lifecycle', () => {
  assert.equal(taskBlocksAssetReady('GENERATE_RENDITIONS'), true);
  assert.equal(taskBlocksAssetReady('GENERATE_THUMBNAIL'), true);
  assert.equal(taskBlocksAssetReady('EXTRACT_COLOR_PALETTE'), false);
  assert.equal(taskBlocksAssetReady('PURGE_ASSET'), false);
});

test('background scheduling supports always, manual, daytime and cross-midnight windows', () => {
  assert.equal(
    canClaimBackgroundJobs('ALWAYS', '23:00', '06:00', new Date('2026-08-14T04:00:00+08:00')),
    true,
  );
  assert.equal(
    canClaimBackgroundJobs('MANUAL', '23:00', '06:00', new Date('2026-08-14T23:30:00+08:00')),
    false,
  );
  assert.equal(
    canClaimBackgroundJobs('NIGHT', '23:00', '06:00', new Date('2026-08-14T23:30:00+08:00')),
    true,
  );
  assert.equal(
    canClaimBackgroundJobs('NIGHT', '23:00', '06:00', new Date('2026-08-14T07:00:00+08:00')),
    false,
  );
  assert.equal(
    canClaimBackgroundJobs('NIGHT', '01:00', '05:00', new Date('2026-08-14T03:00:00+08:00')),
    true,
  );
  assert.equal(
    canClaimBackgroundJobs('NIGHT', '01:00', '05:00', new Date('2026-08-14T22:00:00+08:00')),
    false,
  );
});
