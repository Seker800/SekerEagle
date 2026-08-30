export interface RuntimeTarget {
  databaseUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
}

export const EAGLE_AI_TAG_DEFAULT_MODEL = 'qwen3-vl:8b-instruct';
export const EAGLE_AI_TAG_PROCESSOR_VERSION = 'ollama-concrete-nouns-8b-instruct-v2';
export const EAGLE_AI_TAG_PROMPT_VERSION = 'concrete-nouns-zh-v2';

const allowedDatabaseNames = new Set(['sekereagle', 'sekereagle_test']);
const allowedDatabaseHosts = new Set(['127.0.0.1', 'localhost', 'postgres', 'postgres-test']);
const allowedS3Hosts = new Set(['127.0.0.1', 'localhost', 'minio', 'minio-test']);

export function assertSafeRuntimeTarget(target: RuntimeTarget): void {
  const database = new URL(target.databaseUrl);
  const databaseName = database.pathname.replace(/^\//, '');
  const s3 = new URL(target.s3Endpoint);

  if (database.hostname === '192.168.31.89' || s3.hostname === '192.168.31.89') {
    throw new Error('拒绝连接 SekerChat/NAS 数据面');
  }
  if (!allowedDatabaseHosts.has(database.hostname)) {
    throw new Error(`数据库 host 不在 SekerEagle allowlist: ${database.hostname}`);
  }
  if (!allowedDatabaseNames.has(databaseName) || databaseName.includes('sekerchat')) {
    throw new Error(`数据库名不安全: ${databaseName}`);
  }
  if (!allowedS3Hosts.has(s3.hostname)) {
    throw new Error(`对象存储 host 不在 SekerEagle allowlist: ${s3.hostname}`);
  }
  if (!/^sekereagle-[a-z0-9-]+$/.test(target.s3Bucket)) {
    throw new Error(`对象存储 bucket 不安全: ${target.s3Bucket}`);
  }
}

export function describeRuntimeTarget(target: RuntimeTarget): string {
  const database = new URL(target.databaseUrl);
  const s3 = new URL(target.s3Endpoint);
  return JSON.stringify({
    databaseHost: database.hostname,
    databasePort: database.port || '5432',
    databaseName: database.pathname.replace(/^\//, ''),
    s3Host: s3.hostname,
    s3Port: s3.port || (s3.protocol === 'https:' ? '443' : '80'),
    s3Bucket: target.s3Bucket,
  });
}
