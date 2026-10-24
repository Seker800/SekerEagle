import assert from 'node:assert/strict';
import test from 'node:test';
import { nextEligibleWakeAt } from './job-wakeup';
import { mediaBackgroundAllowed } from './processing-policy';

const setting = {
  mode: 'MANUAL' as const,
  nightStart: '23:00',
  nightEnd: '06:00',
  aiTagManualEnabled: true,
  aiTagScheduleEnabled: false,
  aiTagScheduleStart: '23:00',
  aiTagScheduleEnd: '06:00',
};
test('global pause also stops enabled AI tags and video playback claims', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_AI_TAGS', now), false);
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_PREVIEW', now), false);
  assert.equal(
    nextEligibleWakeAt(
      { availableAt: now, lane: 'BACKGROUND', kind: 'GENERATE_AI_TAGS' },
      setting,
      now,
    ),
    null,
  );
});
test('AI opt-in remains required after resuming and both time windows must allow execution', () => {
  const now = new Date('2026-10-24T04:00:00Z');
  assert.equal(
    mediaBackgroundAllowed(
      { ...setting, mode: 'ALWAYS', aiTagManualEnabled: false },
      'GENERATE_AI_TAGS',
      now,
    ),
    false,
  );
  assert.equal(
    mediaBackgroundAllowed({ ...setting, mode: 'ALWAYS' }, 'GENERATE_AI_TAGS', now),
    true,
  );
  assert.equal(
    mediaBackgroundAllowed({ ...setting, mode: 'NIGHT' }, 'GENERATE_AI_TAGS', now),
    false,
  );
  const enabled = {
    ...setting,
    mode: 'NIGHT' as const,
    aiTagManualEnabled: false,
    aiTagScheduleEnabled: true,
    aiTagScheduleStart: '01:00',
    aiTagScheduleEnd: '03:00',
  };
  assert.equal(
    nextEligibleWakeAt(
      { availableAt: now, lane: 'BACKGROUND', kind: 'GENERATE_AI_TAGS' },
      enabled,
      now,
    )?.toISOString(),
    '2026-10-24T17:00:00.000Z',
  );
});
