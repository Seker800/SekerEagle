import assert from 'node:assert/strict';
import test from 'node:test';
import { taskGroupPresentation } from './task-engine';
import type { TaskGroup } from './task-scheduling';

const schedule = { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' };
const group: TaskGroup = {
  id: 'EMBEDDING',
  background: true,
  queued: 3,
  running: 0,
  failed: 0,
  completed: 0,
  approval: 0,
  waiting: [],
  steps: [],
};

test('recomputing presentation ignores an old derived section after policy changes', () => {
  const previous = taskGroupPresentation(
    { ...group, policy: { paused: true, priority: 0 } },
    schedule,
  );
  const resumed = { ...group, policy: { paused: false, priority: 0 }, presentation: previous };
  assert.equal(taskGroupPresentation(resumed, schedule).section, 'IMMEDIATE');
  assert.equal(taskGroupPresentation(resumed, schedule).status, 'QUEUED');
});

test('model-dependent folder work waits for its host without blocking matching over saved vectors', () => {
  const folder: TaskGroup = {
    ...group,
    id: 'SMART_FOLDERS',
    queued: 0,
    running: 1,
    steps: [
      { id: 'SMART_FOLDER_QUERY', queued: 0, running: 1, completed: 0, failed: 0, approval: 0 },
    ],
  };
  assert.equal(taskGroupPresentation(folder, schedule, 'OFFLINE').status, 'WAITING');
  assert.equal(taskGroupPresentation(folder, schedule, 'DRIFTED').reason, 'MODEL_DRIFTED');
  assert.equal(
    taskGroupPresentation(
      { ...folder, steps: [{ ...folder.steps[0]!, id: 'SMART_FOLDERS' }] },
      schedule,
      'OFFLINE',
    ).status,
    'RUNNING',
  );
  assert.equal(
    taskGroupPresentation(
      {
        ...folder,
        running: 2,
        steps: [...folder.steps, { ...folder.steps[0]!, id: 'SMART_FOLDERS' }],
      },
      schedule,
      'OFFLINE',
    ).status,
    'RUNNING',
  );
});
