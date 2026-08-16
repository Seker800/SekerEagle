import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let config;
try {
  config = require('../packages/config/dist/index.js');
} catch {
  throw new Error('请先运行 npm run build --workspace @sekereagle/config');
}

const target = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  s3Bucket: process.env.S3_BUCKET ?? '',
};

config.assertSafeRuntimeTarget(target);
process.stdout.write(`SekerEagle target accepted: ${config.describeRuntimeTarget(target)}\n`);
