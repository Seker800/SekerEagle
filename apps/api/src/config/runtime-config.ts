import { assertSafeRuntimeTarget } from '@sekereagle/config';

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  canonicalOrigin: string;
  databaseUrl: string;
  jwtAccessSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  s3Endpoint: string;
  s3PublicEndpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

function required(env: Record<string, unknown>, key: string): string {
  const value = typeof env[key] === 'string' ? env[key].trim() : '';
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function positiveInteger(env: Record<string, unknown>, key: string): number {
  const value = Number(required(env, key));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${key} must be a positive integer`);
  return value;
}

export function validateEnvironment(env: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = (
    typeof env.NODE_ENV === 'string' ? env.NODE_ENV : 'development'
  ) as RuntimeConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv))
    throw new Error('NODE_ENV is invalid');

  const canonicalOrigin = required(env, 'CANONICAL_ORIGIN');
  const origin = new URL(canonicalOrigin);
  const loopbackHttp = origin.protocol === 'http:' && origin.hostname === 'localhost';
  if (origin.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('CANONICAL_ORIGIN must use HTTPS unless it is http://localhost');
  }
  if (
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error('CANONICAL_ORIGIN must be a bare origin');
  }

  const jwtAccessSecret = required(env, 'JWT_ACCESS_SECRET');
  if (jwtAccessSecret.length < 32)
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters');

  const databaseUrl = required(env, 'DATABASE_URL');
  const s3Endpoint = required(env, 'S3_ENDPOINT');
  const s3PublicEndpoint = required(env, 'S3_PUBLIC_ENDPOINT');
  const s3Bucket = required(env, 'S3_BUCKET');
  assertSafeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket });
  if (new URL(s3PublicEndpoint).origin !== origin.origin) {
    throw new Error('S3_PUBLIC_ENDPOINT must use CANONICAL_ORIGIN');
  }

  return {
    ...env,
    NODE_ENV: nodeEnv,
    PORT: positiveInteger({ ...env, PORT: env.PORT ?? '3000' }, 'PORT'),
    CANONICAL_ORIGIN: origin.origin,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    ACCESS_TOKEN_TTL_SECONDS: positiveInteger(env, 'ACCESS_TOKEN_TTL_SECONDS'),
    REFRESH_TOKEN_TTL_SECONDS: positiveInteger(env, 'REFRESH_TOKEN_TTL_SECONDS'),
    S3_ENDPOINT: s3Endpoint,
    S3_PUBLIC_ENDPOINT: s3PublicEndpoint,
    S3_REGION: required(env, 'S3_REGION'),
    S3_BUCKET: s3Bucket,
    S3_ACCESS_KEY_ID: required(env, 'S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: required(env, 'S3_SECRET_ACCESS_KEY'),
  };
}
