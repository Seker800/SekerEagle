import { PrismaPg } from '@prisma/adapter-pg';

/** Keep the existing connection URL budgets when moving from Prisma's Rust pool to pg. */
export function databasePoolConfig(connectionString = process.env.DATABASE_URL ?? '') {
  const url = new URL(connectionString);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', 'postgres', 'postgres-test'].includes(url.hostname) ||
    !['/sekereagle', '/sekereagle_test'].includes(url.pathname)
  ) {
    throw new Error('Unsafe SekerEagle database target');
  }
  const seconds = (key: string, fallback: number) => {
    const value = Number(url.searchParams.get(key) ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid database ${key}`);
    return value * 1000;
  };
  const limit = url.searchParams.get('connection_limit');
  const max = limit === null ? undefined : Number(limit);
  if (max !== undefined && (!Number.isSafeInteger(max) || max < 1)) {
    throw new Error('Invalid database connection_limit');
  }
  return {
    connectionString,
    ...(max === undefined ? {} : { max }),
    connectionTimeoutMillis: seconds('connect_timeout', 5),
    idleTimeoutMillis: seconds('max_idle_connection_lifetime', 300),
  };
}

export function createPrismaAdapter(connectionString?: string) {
  const config = databasePoolConfig(connectionString);
  const schema = new URL(config.connectionString).searchParams.get('schema') ?? 'public';
  return new PrismaPg(config, { schema });
}
