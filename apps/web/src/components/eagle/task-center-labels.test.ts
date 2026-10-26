import { describe, expect, it } from 'vitest';
import {
  TASK_FAMILIES,
  isBackgroundFamily,
  type TaskGroup,
  type TaskWaitReason,
} from '@sekereagle/library-core';
import {
  taskFamilyLabels,
  taskExecutionLabel,
  taskWaitLabel,
  taskStepLabel,
} from './task-center-labels';

describe('task explanations', () => {
  it('names each supported category and its dependency, computing location and execution trigger', () => {
    for (const id of TASK_FAMILIES) {
      expect(taskFamilyLabels(id).every((label) => label.length > 0)).toBe(true);
      const group: TaskGroup = {
        id,
        background: isBackgroundFamily(id),
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        approval: 0,
        steps: [],
        waiting: [],
      };
      expect(
        taskExecutionLabel(group, { mode: 'NIGHT', nightStart: '02:00', nightEnd: '10:00' }),
      ).not.toBe('');
      expect(taskStepLabel(id)).toBe(taskFamilyLabels(id)[0]);
    }
  });
  it('explains distinct recovery actions for dependency, model, server and human waits', () => {
    const reasons: TaskWaitReason[] = [
      'MODEL_OFFLINE',
      'MODEL_DRIFTED',
      'DEPENDENCY',
      'DEPENDENCY_FAILED',
      'PAUSED',
      'SCHEDULE',
      'DISABLED',
      'WORKER_OFFLINE',
      'RETRY',
      'QUEUED',
      'APPROVAL',
    ];
    expect(new Set(reasons.map(taskWaitLabel)).size).toBe(reasons.length);
    expect(taskWaitLabel('DEPENDENCY_FAILED')).toContain('重试');
    expect(taskWaitLabel('MODEL_OFFLINE')).toContain('模型节点');
    for (const step of [
      'SMART_FOLDER_QUERY',
      'GENERATE_RENDITIONS',
      'GENERATE_THUMBNAIL',
      'GENERATE_PREVIEW',
      'PROBE_MEDIA',
      'GENERATE_EMBEDDING',
      'ANALYZE_PHOTO_FACES',
      'EXTRACT_COLOR_PALETTE',
      'GENERATE_IMAGE_PYRAMID',
      'PURGE_ASSET',
      'OBJECT_DELETION',
    ])
      expect(taskStepLabel(step)).not.toBe('其他处理步骤');
    expect(taskStepLabel('UNKNOWN_STEP')).toBe('其他处理步骤');
  });
});

it('separates computing, queued, stopped failures and completed without hiding active work during draining', async () => {
  const { taskStatusLabel } = await import('./task-center-labels');
  const group: TaskGroup = {
    id: 'EMBEDDING',
    background: true,
    queued: 0,
    running: 0,
    failed: 0,
    completed: 10,
    approval: 0,
    waiting: [],
    steps: [],
  };
  const schedule = { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' };
  expect(taskStatusLabel(group, schedule)).toBe('已完成');
  expect(taskStatusLabel({ ...group, queued: 2 }, schedule)).toBe('排队ing');
  expect(taskStatusLabel({ ...group, failed: 3 }, schedule)).toBe('已停止（3项失败）');
  expect(
    taskStatusLabel(
      { ...group, queued: 2, failed: 1, policy: { paused: true, priority: 0 } },
      schedule,
    ),
  ).toBe('已停止（1项失败）');
  expect(taskStatusLabel({ ...group, queued: 2 }, { ...schedule, mode: 'MANUAL' })).toBe('已停止');
  expect(
    taskStatusLabel(
      { ...group, running: 1, failed: 1, policy: { paused: true, priority: 0 } },
      schedule,
    ),
  ).toBe('计算ing');
});

it('uses the server decision instead of reinterpreting its status from browser flags', async () => {
  const { taskStatusLabel } = await import('./task-center-labels');
  const group = {
    id: 'EMBEDDING',
    background: true,
    queued: 1,
    running: 0,
    failed: 0,
    completed: 0,
    approval: 0,
    waiting: [],
    steps: [],
    presentation: { status: 'WAITING', section: 'IMMEDIATE', reason: 'WORKER_OFFLINE' },
  } as TaskGroup;
  expect(taskStatusLabel(group, { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' })).toBe(
    '等待处理服务',
  );
});

it('shows a bounded model capacity wait without claiming the host is offline', async () => {
  const { taskWaitLabel, taskStatusLabel } = await import('./task-center-labels');
  expect(taskWaitLabel('MODEL_BUSY')).toBe('等待模型空闲');
  const group = {
    id: 'EMBEDDING',
    background: true,
    queued: 1,
    running: 0,
    failed: 0,
    completed: 0,
    approval: 0,
    waiting: [],
    steps: [],
    presentation: { status: 'WAITING', section: 'IMMEDIATE', reason: 'MODEL_BUSY' },
  } as TaskGroup;
  expect(taskStatusLabel(group, { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' })).toBe(
    '等待模型空闲',
  );
});

it('multi-host model metadata does not claim that Mac is the only executor', () => {
  expect(taskFamilyLabels('EMBEDDING').join(' ')).not.toContain('Mac');
});

it('keeps server-only pyramid computation labelled at the library server', () => {
  expect(taskFamilyLabels('PYRAMID')[3]).toBe('图库服务器 · 较重');
});
