import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleMediaJobKind, EagleProcessingLane } from '@prisma/client';
import * as core from '@sekereagle/library-core';

test('pure job and lane registries cover the actual persisted enums', () => {
  const contract = core as unknown as {
    MEDIA_JOB_KINDS: readonly string[];
    MEDIA_JOB_LANES: Readonly<Record<string, string>>;
    PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION: string;
  };
  assert.ok(Array.isArray(contract.MEDIA_JOB_KINDS), 'job kinds need one shared registry');
  assert.deepEqual(new Set(contract.MEDIA_JOB_KINDS), new Set(Object.values(EagleMediaJobKind)));
  assert.deepEqual(
    new Set(Object.keys(contract.MEDIA_JOB_LANES)),
    new Set(Object.values(EagleMediaJobKind)),
  );
  assert.deepEqual(
    new Set(Object.values(contract.MEDIA_JOB_LANES)),
    new Set(Object.values(EagleProcessingLane)),
  );
  assert.equal(contract.PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION, 'photo-source-details-v1');
});
