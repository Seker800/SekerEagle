import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EagleController } from './eagle.controller';
import { EagleMediaService } from './eagle-media.service';
import { EagleService } from './eagle.service';
import { EagleUploadController } from './eagle-upload.controller';
import { EagleUploadService } from './eagle-upload.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [EagleController, EagleUploadController],
  providers: [EagleService, EagleMediaService, EagleUploadService],
  exports: [EagleService],
})
export class EagleModule {}
