import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { installEditRequestBodyParser } from './eagle/eagle-edit-request-body';
import { installOperationRequestBodyParser } from './eagle/eagle-operation-request-body';
import { installPhotoRequestBodyParser } from './photos/photo-request-body';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  installOperationRequestBodyParser(app);
  installPhotoRequestBodyParser(app);
  installEditRequestBodyParser(app);
  const config = app.get(ConfigService);
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.setGlobalPrefix('api');
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap();
