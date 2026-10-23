import { PhotoMapService } from './photo-map.service';
import { PhotoAgentService } from './photo-agent.service';
import { PhotoAgentController } from './photo-agent.controller';
import { PhotoManagementController } from './photo-management.controller';
import { PhotoManagementService } from './photo-management.service';
import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  Res,
  SetMetadata,
  UseGuards,
  Module,
} from '@nestjs/common';
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
import type { Request, Response } from 'express';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrivacyVisibilityService } from '../auth/privacy-visibility.service';
import { UpdatePrivacyVisibilityDto } from '../auth/dto';
import { PhotoRevisionObserver } from './photo-revision.observer';
import { LIBRARY_MODE, LIBRARY_REVISION_OBSERVER } from '../eagle/library-mode';

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@ApiTags('photos')
@Controller('photos')
export class PhotosController extends EagleController {}

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@ApiTags('photo-uploads')
@Controller('photos/uploads')
export class PhotoUploadsController extends EagleUploadController {}

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@ApiTags('photo-ai-tags')
@Controller('photos/ai-tags')
export class PhotoAiTagsController extends EagleAiTagController {}

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@ApiTags('photo-vectors')
@Controller('photos/vector')
export class PhotoVectorsController extends EagleVectorController {}

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@ApiTags('photo-processing')
@Controller('admin/photo-processing')
export class PhotoProcessingController extends EagleProcessingController {}

@SetMetadata(LIBRARY_MODE, 'PHOTO')
@Controller('photos/privacy-visibility')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class PhotoPrivacyVisibilityController {
  constructor(private readonly visibility: PrivacyVisibilityService) {}
  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal, @Req() request: Request) {
    return this.visibility.getStatus(principal.sub, request, 'PHOTO');
  }
  @Put()
  @UseGuards(BrowserOriginGuard)
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: UpdatePrivacyVisibilityDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.visibility.update(principal.sub, response, input, 'PHOTO');
  }
}

/** Mode is a fixed dependency of this module, never a mutable current-page setting. */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    PhotosController,
    PhotoManagementController,
    PhotoAgentController,
    PhotoPrivacyVisibilityController,
    PhotoUploadsController,
    PhotoAiTagsController,
    PhotoVectorsController,
    PhotoProcessingController,
  ],
  providers: [
    PhotoManagementService,
    PhotoMapService,
    PhotoAgentService,
    PhotoRevisionObserver,
    { provide: LIBRARY_REVISION_OBSERVER, useExisting: PhotoRevisionObserver },
    ...EAGLE_LIBRARY_PROVIDERS.filter((provider) => provider !== EagleMaintenanceService),
    { provide: LIBRARY_MODE, useValue: 'PHOTO' },
  ],
})
export class PhotoLibraryModule {}
