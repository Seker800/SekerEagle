import { BadRequestException } from '@nestjs/common';
import { TASK_FAMILIES, type TaskFamily } from '@sekereagle/library-core';
import type { LibraryCommandRegistry } from './eagle-library-command';
import type { EagleTaskCenterService } from './eagle-task-center.service';

export function registerTaskCommands(
  registry: LibraryCommandRegistry,
  tasks: EagleTaskCenterService,
) {
  registry.register('TASK_FAMILY_RETRY', {
    protocol: 'METADATA',
    admit: (_context, payload) => {
      if (!TASK_FAMILIES.includes(payload.family as TaskFamily))
        throw new BadRequestException('任务类别无效。');
    },
    apply: async (tx, context, payload) => {
      await tasks.retry(context.ownerId, payload.family as TaskFamily, context.includePrivate, tx);
    },
  });
}
