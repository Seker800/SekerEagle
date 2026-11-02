import { registerTaskCommands } from './eagle-task-commands';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { registerDuplicateCommands } from './eagle-duplicate-commands';
import { EagleDuplicateService } from './eagle-duplicates.service';
import { registerBatchEditCommands } from './eagle-batch-edit';
import { PrismaService } from '../prisma/prisma.service';
import { Inject, Injectable } from '@nestjs/common';
import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE } from './library-mode';
import { LibraryCommandRegistry } from './eagle-library-command';
import { registerSharedLibraryCommands } from './eagle-shared-commands';
import { EagleService } from './eagle.service';
import { EaglePrivacyService } from './eagle-privacy.service';
import { EagleVectorService } from './eagle-vector.service';
import { EagleProcessingService } from './eagle-processing.service';

/** Registration is passive: only the separate operations process executes commands. */
@Injectable()
export class EagleLibraryCommandSetup {
  constructor(
    registry: LibraryCommandRegistry,
    prisma: PrismaService,
    eagle: EagleService,
    privacy: EaglePrivacyService,
    vectors: EagleVectorService,
    processing: EagleProcessingService,
    duplicates: EagleDuplicateService,
    tasks: EagleTaskCenterService,
    @Inject(LIBRARY_MODE) readonly mode: LibraryMode,
  ) {
    registerSharedLibraryCommands(registry, { eagle, privacy, vectors, processing });
    registerBatchEditCommands(registry, prisma);
    registerDuplicateCommands(registry, duplicates);
    registerTaskCommands(registry, tasks);
  }
}
