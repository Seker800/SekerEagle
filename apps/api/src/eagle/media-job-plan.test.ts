import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImageProcessingJobs, needsImagePyramid } from './media-job-plan';

test('large images get dependent palette and pyramid jobs after renditions', () => {
  const jobs = buildImageProcessingJobs(
    { ownerId: 'owner-1', assetId: 'asset-1', assetRevision: 2, width: 8_000, height: 6_000 },
    'rendition-job',
  );

  assert.deepEqual(
    jobs.map(({ id: _id, ...job }) => job),
    [
      {
        ownerId: 'owner-1',
        assetId: 'asset-1',
        assetRevision: 2,
        kind: 'GENERATE_RENDITIONS',
        lane: 'INTERACTIVE',
        processorVersion: 'rendition-v2',
        dependsOnJobId: null,
      },
      {
        ownerId: 'owner-1',
        assetId: 'asset-1',
        assetRevision: 2,
        kind: 'EXTRACT_COLOR_PALETTE',
        lane: 'BACKGROUND',
        processorVersion: 'color-v3-thumbnail',
        dependsOnJobId: 'rendition-job',
      },
      {
        ownerId: 'owner-1',
        assetId: 'asset-1',
        assetRevision: 2,
        kind: 'GENERATE_IMAGE_PYRAMID',
        lane: 'BACKGROUND',
        processorVersion: 'pyramid-v1',
        dependsOnJobId: 'rendition-job',
      },
    ],
  );
});

test('ordinary images skip pyramids while either size threshold enables them', () => {
  assert.equal(needsImagePyramid(4_096, 4_096), false);
  assert.equal(needsImagePyramid(4_097, 1), true);
  assert.equal(needsImagePyramid(4_000, 4_001), true);
  assert.equal(needsImagePyramid(null, 8_000), false);
});
