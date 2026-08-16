import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function generate(): Promise<void> {
  process.env.NODE_ENV ??= 'test';
  process.env.PORT ??= '3000';
  process.env.CANONICAL_ORIGIN ??= 'http://localhost:8180';
  process.env.DATABASE_URL ??=
    'postgresql://sekereagle:contract-only@postgres-test:5432/sekereagle_test?schema=public';
  process.env.JWT_ACCESS_SECRET ??= 'contract-generation-secret-with-32-characters';
  process.env.ACCESS_TOKEN_TTL_SECONDS ??= '900';
  process.env.REFRESH_TOKEN_TTL_SECONDS ??= '2592000';
  process.env.S3_ENDPOINT ??= 'http://minio-test:9000';
  process.env.S3_PUBLIC_ENDPOINT ??= 'http://localhost:8180';
  process.env.S3_REGION ??= 'us-east-1';
  process.env.S3_BUCKET ??= 'sekereagle-test-assets';
  process.env.S3_ACCESS_KEY_ID ??= 'contract-only';
  process.env.S3_SECRET_ACCESS_KEY ??= 'contract-only-secret';
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('SekerEagle API').setVersion('0.1.0').build(),
  );
  await writeFile(
    resolve(process.cwd(), '../../packages/contracts/openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  await app.close();
}

void generate();
