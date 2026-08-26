import { isIP } from 'node:net';
import { assertSafeRuntimeTarget } from '@sekereagle/config';

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  canonicalOrigin: string;
  browserTrustedOrigins: string[];
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

function boundedInteger(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[key] ?? fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalBoolean(env: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined) return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

function parseTrustedBrowserOrigins(
  env: Record<string, unknown>,
  canonicalOrigin: string,
): string[] {
  const configured =
    typeof env.BROWSER_TRUSTED_ORIGINS === 'string'
      ? env.BROWSER_TRUSTED_ORIGINS.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  if (configured.length > 8) throw new Error('BROWSER_TRUSTED_ORIGINS accepts at most 8 origins');

  const origins = [canonicalOrigin];
  for (const value of configured) {
    let origin: URL;
    try {
      origin = new URL(value);
    } catch {
      throw new Error('BROWSER_TRUSTED_ORIGINS contains an invalid URL');
    }
    if (
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password ||
      origin.hostname.includes('*')
    ) {
      throw new Error('BROWSER_TRUSTED_ORIGINS must contain bare exact origins');
    }
    if (origin.hostname === '192.168.31.89') {
      throw new Error('BROWSER_TRUSTED_ORIGINS contains a forbidden host');
    }
    if (!['http:', 'https:'].includes(origin.protocol)) {
      throw new Error('BROWSER_TRUSTED_ORIGINS entries must use HTTP or HTTPS');
    }
    if (origin.protocol === 'http:' && !isTrustedHttpHost(origin.hostname)) {
      throw new Error('BROWSER_TRUSTED_ORIGINS HTTP entries must use loopback or a private IP');
    }
    if (!origins.includes(origin.origin)) origins.push(origin.origin);
  }
  return origins;
}

function isTrustedHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split('.').map(Number);
    const first = octets[0] ?? Number.NaN;
    const second = octets[1] ?? Number.NaN;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  return version === 6 && (/^f[cd]/.test(host) || /^fe[89ab]/.test(host));
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
  const browserTrustedOrigins = parseTrustedBrowserOrigins(env, origin.origin);

  return {
    ...env,
    NODE_ENV: nodeEnv,
    PORT: positiveInteger({ ...env, PORT: env.PORT ?? '3000' }, 'PORT'),
    CANONICAL_ORIGIN: origin.origin,
    BROWSER_TRUSTED_ORIGINS: browserTrustedOrigins,
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
    S3_CONNECTION_TIMEOUT_MS: boundedInteger(env, 'S3_CONNECTION_TIMEOUT_MS', 3_000, 250, 30_000),
    S3_REQUEST_TIMEOUT_MS: boundedInteger(env, 'S3_REQUEST_TIMEOUT_MS', 12_000, 1_000, 60_000),
    S3_SOCKET_TIMEOUT_MS: boundedInteger(env, 'S3_SOCKET_TIMEOUT_MS', 10_000, 1_000, 60_000),
    S3_MAX_SOCKETS: boundedInteger(env, 'S3_MAX_SOCKETS', 64, 4, 512),
    EAGLE_MEDIA_THROTTLE_V2_ENABLED: optionalBoolean(env, 'EAGLE_MEDIA_THROTTLE_V2_ENABLED', true),
    EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND: boundedInteger(
      env,
      'EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND',
      256,
      32,
      2_000,
    ),
    EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE: boundedInteger(
      env,
      'EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE',
      6_000,
      1_000,
      120_000,
    ),
    EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND: boundedInteger(
      env,
      'EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND',
      1_024,
      128,
      10_000,
    ),
    EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE: boundedInteger(
      env,
      'EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE',
      24_000,
      4_000,
      1_000_000,
    ),
  };
}
