import assert from 'node:assert/strict';
import test from 'node:test';
import { nextEligibleWakeAt } from './job-wakeup';
import { mediaBackgroundAllowed } from './processing-policy';

test('retired AI tagging cannot run or schedule a wake-up even with old opt-in settings', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  const setting = {
    mode: 'ALWAYS' as const,
    nightStart: '23:00',
    nightEnd: '06:00',
    aiTagManualEnabled: true,
  };
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_AI_TAGS', now), false);
  assert.equal(
    nextEligibleWakeAt(
      { availableAt: now, lane: 'BACKGROUND', kind: 'GENERATE_AI_TAGS' },
      setting,
      now,
    ),
    null,
  );
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_EMBEDDING', now), true);
});

test('global pause continues to stop active analysis and video jobs', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  const setting = { mode: 'MANUAL' as const, nightStart: '23:00', nightEnd: '06:00' };
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_PREVIEW', now), false);
  assert.equal(mediaBackgroundAllowed(setting, 'GENERATE_EMBEDDING', now), false);
});
