import { libraryProviders } from './library-capabilities';
import { Module } from '@nestjs/common';
import { LIBRARY_MODE } from './library-mode';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EagleController } from './eagle.controller';
import { EagleBrowserCaptureController } from './eagle-browser-capture.controller';
import { EagleImportController } from './eagle-import.controller';
import { EagleProcessingController } from './eagle-processing.controller';
import { EagleTaskCenterController } from './eagle-task-center.controller';
import { EagleVectorController } from './eagle-vector.controller';
import { EagleService } from './eagle.service';
import { EagleUploadController } from './eagle-upload.controller';

export { EAGLE_LIBRARY_CAPABILITIES, EAGLE_LIBRARY_PROVIDERS } from './library-capabilities';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    EagleController,
    EagleBrowserCaptureController,
    EagleUploadController,
    EagleImportController,
    EagleProcessingController,
    EagleTaskCenterController,
    EagleVectorController,
  ],
  providers: [...libraryProviders('MATERIAL'), { provide: LIBRARY_MODE, useValue: 'MATERIAL' }],
  exports: [EagleService],
})
export class EagleModule {}
