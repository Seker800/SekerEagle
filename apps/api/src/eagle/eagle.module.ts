import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EagleController } from './eagle.controller';
import { EagleImportController } from './eagle-import.controller';
import { EagleImportService } from './eagle-import.service';
import { EagleMediaService } from './eagle-media.service';
import { EagleProcessingController } from './eagle-processing.controller';
import { EagleProcessingService } from './eagle-processing.service';
import { EagleService } from './eagle.service';
import { EagleUploadController } from './eagle-upload.controller';
import { EagleUploadService } from './eagle-upload.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [EagleController, EagleUploadController, EagleImportController, EagleProcessingController],
  providers: [EagleService, EagleMediaService, EagleUploadService, EagleImportService, EagleProcessingService],
  exports: [EagleService],
})
export class EagleModule {}
