import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validateSync } from 'class-validator';
import { EagleModule } from './eagle.module';
import { PhotoLibraryModule } from '../photos/photo-library.module';
import { EagleProcessingService } from './eagle-processing.service';
import { RetryTaskFamilyDto, TaskPolicyDto } from './eagle-task-center.controller';
import { ListEagleProcessingJobsDto } from './eagle-processing.dto';

test('neither library registers retired generation routes or accepts its task controls', () => {
  for (const module of [EagleModule, PhotoLibraryModule]) {
    const controllers: object[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module);
    assert.ok(controllers.length);
    for (const controller of controllers)
      assert.doesNotMatch(String(Reflect.getMetadata(PATH_METADATA, controller)), /ai-tags/);
  }
  for (const input of [
    Object.assign(new RetryTaskFamilyDto(), { family: 'AI_TAGS' }),
    Object.assign(new TaskPolicyDto(), { family: 'AI_TAGS', paused: false, priority: 1 }),
    Object.assign(new ListEagleProcessingJobsDto(), { kind: 'GENERATE_AI_TAGS' }),
  ])
    assert.ok(validateSync(input).length > 0);
});

test('legacy per-job retry returns 404 without changing any job or asset', async () => {
  const service = new EagleProcessingService(
    {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          eagleAssetProcessingJob: {
            findFirst: async () => ({ id: 'retired', kind: 'GENERATE_AI_TAGS' }),
            updateMany: async () => {
              throw new Error('Must not revive retired jobs');
            },
          },
        }),
    } as never,
    'MATERIAL',
  );
  await assert.rejects(service.retry('owner', 'retired'), { status: 404 });
});
