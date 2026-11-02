import { Injectable } from '@nestjs/common';
import { LibraryCommandRegistry } from '../eagle/eagle-library-command';
import { PhotoManagementService } from './photo-management.service';
import { PhotoPersonReviewService } from './photo-person-review.service';
import { PhotoAgentService } from './photo-agent.service';
import { registerPhotoLibraryCommands } from './photo-library-commands';

/** PHOTO supplies its domain handlers; it never replaces shared orchestration. */
@Injectable()
export class PhotoLibraryCommandSetup {
  constructor(
    registry: LibraryCommandRegistry,
    photos: PhotoManagementService,
    review: PhotoPersonReviewService,
    agent: PhotoAgentService,
  ) {
    registerPhotoLibraryCommands(registry, { photos, review, agent });
  }
}
