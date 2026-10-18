import { Controller, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EagleController } from '../eagle/eagle.controller';
import { EagleUploadController } from '../eagle/eagle-upload.controller';
import { EagleAiTagController } from '../eagle/eagle-ai-tag.controller';
import { EagleVectorController } from '../eagle/eagle-vector.controller';
import { EagleProcessingController } from '../eagle/eagle-processing.controller';
import { EAGLE_LIBRARY_PROVIDERS } from '../eagle/eagle.module';
import { EagleMaintenanceService } from '../eagle/eagle-maintenance.service';
import { LIBRARY_MODE } from '../eagle/library-mode';

@ApiTags('photos')
@Controller('photos')
export class PhotosController extends EagleController {}

@ApiTags('photo-uploads')
@Controller('photos/uploads')
export class PhotoUploadsController extends EagleUploadController {}

@ApiTags('photo-ai-tags')
@Controller('photos/ai-tags')
export class PhotoAiTagsController extends EagleAiTagController {}

@ApiTags('photo-vectors')
@Controller('photos/vector')
export class PhotoVectorsController extends EagleVectorController {}

@ApiTags('photo-processing')
@Controller('admin/photo-processing')
export class PhotoProcessingController extends EagleProcessingController {}

/** Mode is a fixed dependency of this module, never a mutable current-page setting. */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    PhotosController,
    PhotoUploadsController,
    PhotoAiTagsController,
    PhotoVectorsController,
    PhotoProcessingController,
  ],
  providers: [
    ...EAGLE_LIBRARY_PROVIDERS.filter((provider) => provider !== EagleMaintenanceService),
    { provide: LIBRARY_MODE, useValue: 'PHOTO' },
  ],
})
export class PhotoLibraryModule {}
