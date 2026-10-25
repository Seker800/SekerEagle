import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImageProcessingJobs,
  buildMissingImageProcessingJobs,
  needsImagePyramid,
} from './media-job-plan';

test('new uploads and reconciliation never recreate retired AI tag generation', () => {
  const input = { ownerId: 'owner', assetId: 'asset', assetRevision: 1, width: 800, height: 600 };
  for (const jobs of [
    buildImageProcessingJobs(input),
    buildMissingImageProcessingJobs(input, []),
  ]) {
    assert.ok(jobs.every((job) => job.kind !== 'GENERATE_AI_TAGS'));
    assert.ok(jobs.some((job) => job.kind === 'GENERATE_EMBEDDING'));
  }
});

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
      {
        ownerId: 'owner-1',
        assetId: 'asset-1',
        assetRevision: 2,
        kind: 'GENERATE_EMBEDDING',
        lane: 'BACKGROUND',
        processorVersion: 'qwen3-vl-embedding-2b-1024-v1',
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
    ['GENERATE_EMBEDDING', 'rendition-job'],
  ]);
});

test('backfill does not duplicate a current AI tagging task', () => {
  const jobs = buildMissingImageProcessingJobs(
    { ownerId: 'owner-1', assetId: 'asset-1', assetRevision: 2, width: 1_000, height: 800 },
    [
      {
        id: 'rendition-job',
        kind: 'GENERATE_RENDITIONS',
        processorVersion: 'rendition-v2',
      },
      {
        id: 'ai-tag-job',
        kind: 'GENERATE_AI_TAGS',
        processorVersion: 'ollama-concrete-nouns-8b-instruct-v2',
      },
    ],
  );

  assert.equal(
    jobs.some(({ kind }) => kind === 'GENERATE_AI_TAGS'),
    false,
  );
});

test('backfill does not recreate an AI job when the current revision has a completed analysis', () => {
  const jobs = buildMissingImageProcessingJobs(
    {
      ownerId: 'owner-1',
      assetId: 'asset-1',
      assetRevision: 2,
      width: 1_000,
      height: 800,
    },
    [],
  );

  assert.equal(
    jobs.some(({ kind }) => kind === 'GENERATE_AI_TAGS'),
    false,
  );
  assert.equal(
    jobs.some(({ kind }) => kind === 'GENERATE_EMBEDDING'),
    true,
  );
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

test('job pruning does not regenerate durable current-revision media facts', () => {
  const jobs = buildMissingImageProcessingJobs(
    {
      ownerId: 'owner-1',
      assetId: 'asset-1',
      assetRevision: 2,
      width: 8000,
      height: 6000,
      renditionsReady: true,
      paletteReady: true,
      pyramidReady: true,
      embeddingReady: true,
    },
    [],
  );
  assert.deepEqual(jobs, []);
});

test('missing analysis can depend on ready renditions after rendition job pruning', () => {
  const jobs = buildMissingImageProcessingJobs(
    {
      ownerId: 'owner-1',
      assetId: 'asset-1',
      assetRevision: 2,
      width: 100,
      height: 100,
      renditionsReady: true,
    },
    [],
  );
  expectJobKinds(jobs, [
    ['EXTRACT_COLOR_PALETTE', null],
    ['GENERATE_EMBEDDING', null],
  ]);
});

test('missing heavyweight details are queued separately without rebuilding ready browsing', () => {
  const jobs = buildMissingImageProcessingJobs(
    {
      ownerId: 'owner',
      assetId: 'asset',
      assetRevision: 3,
      width: 6000,
      height: 4000,
      renditionsReady: true,
      paletteReady: true,
      pyramidReady: true,
      embeddingReady: true,
      needsDetails: true,
      detailsReady: false,
    },
    [],
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.processorVersion, 'photo-source-details-v1');
  assert.equal(jobs[0]?.lane, 'BACKGROUND');
  assert.equal(jobs[0]?.dependsOnJobId, null);
});
