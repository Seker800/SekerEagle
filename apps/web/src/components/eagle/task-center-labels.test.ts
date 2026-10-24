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
    expect(taskWaitLabel('MODEL_OFFLINE')).toContain('Mac');
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
