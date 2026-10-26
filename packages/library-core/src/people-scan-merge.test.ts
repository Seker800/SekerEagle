import assert from 'node:assert/strict';
import test from 'node:test';
import { taskGroupPresentation, taskGroupManagement, workerSupportsTask } from './task-engine';
import type { TaskGroup } from './task-scheduling';
const schedule = { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' };
const face: TaskGroup = {
  id: 'FACES',
  background: true,
  unscanned: 1201,
  queued: 0,
  running: 0,
  failed: 0,
  completed: 0,
  approval: 0,
  waiting: [],
  steps: [],
};
test('merged core owns unscanned presentation and scan controls', () => {
  assert.equal(taskGroupPresentation(face, schedule).status, 'UNSCANNED');
  assert.equal(taskGroupManagement(face, schedule).canStart, true);
  assert.equal(taskGroupPresentation({ ...face, unscanned: 0 }, schedule).status, 'EMPTY');
  assert.equal(
    taskGroupManagement({ ...face, availability: 'DISABLED' }, schedule).canStart,
    false,
  );
  assert.equal(
    workerSupportsTask({ background: true, faces: false }, 'FACES', 'ANALYZE_PHOTO_FACES'),
    false,
  );
});
