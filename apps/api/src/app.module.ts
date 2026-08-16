import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, minutes, seconds } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/runtime-config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: seconds(1), limit: 10 },
      { name: 'default', ttl: minutes(1), limit: 120 },
    ]),
    PrismaModule,
    StorageModule,
    AuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
