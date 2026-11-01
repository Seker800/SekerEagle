import { WorkspaceChangesController } from './workspace-changes.controller';
import { WorkspaceChangesService } from './workspace-changes.service';
import { BackupController } from './backup/backup.controller';
import { securityResponse } from './security-response';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/runtime-config';
import { PhotoLibraryModule } from './photos/photo-library.module';
import { EagleModule } from './eagle/eagle.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    StorageModule,
    AuthModule,
    EagleModule,
    PhotoLibraryModule,
    HealthModule,
  ],
  controllers: [BackupController, WorkspaceChangesController],
  providers: [WorkspaceChangesService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(securityResponse).forRoutes('*path');
  }
}
