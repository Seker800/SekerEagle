import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImageProcessingJobs,
  buildMissingImageProcessingJobs,
  needsImagePyramid,
} from './media-job-plan';

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
  assert.equal(needsImagePyramid(4_000, 4_000), false);
  assert.equal(needsImagePyramid(4_097, 1), true);
  assert.equal(needsImagePyramid(4_000, 4_001), true);
  assert.equal(needsImagePyramid(null, 8_000), false);
});

test('backfill reuses a current rendition job as the dependency for missing analysis work', () => {
  const jobs = buildMissingImageProcessingJobs(
    { ownerId: 'owner-1', assetId: 'asset-1', assetRevision: 2, width: 8_000, height: 6_000 },
    [
      {
        id: 'rendition-job',
        kind: 'GENERATE_RENDITIONS',
        processorVersion: 'rendition-v2',
      },
    ],
  );

  expectJobKinds(jobs, [
    ['EXTRACT_COLOR_PALETTE', 'rendition-job'],
    ['GENERATE_IMAGE_PYRAMID', 'rendition-job'],
  ]);
});

function expectJobKinds(
  jobs: ReturnType<typeof buildMissingImageProcessingJobs>,
  expected: Array<[string, string | null | undefined]>,
) {
  assert.deepEqual(
    jobs.map(({ kind, dependsOnJobId }) => [kind, dependsOnJobId]),
    expected,
  );
}
