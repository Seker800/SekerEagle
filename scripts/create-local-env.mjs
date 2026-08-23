import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.cwd(), '.env');
const secret = (bytes) => randomBytes(bytes).toString('base64url');
const contents = `NODE_ENV=production
POSTGRES_USER=sekereagle
POSTGRES_PASSWORD=${secret(32)}
MINIO_ROOT_USER=sekereagle-${secret(8)}
MINIO_ROOT_PASSWORD=${secret(32)}
PORT=3000
SEKEREAGLE_GATEWAY_LAN_ADDRESS=
CANONICAL_ORIGIN=http://localhost:8180
DATABASE_URL=postgresql://sekereagle:compose-only@postgres:5432/sekereagle?schema=public
JWT_ACCESS_SECRET=${secret(48)}
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=sekereagle-assets
S3_ACCESS_KEY_ID=compose-only
S3_SECRET_ACCESS_KEY=compose-only
MLX_EMBEDDING_TOKEN=${secret(48)}
MLX_EMBEDDING_REVISION=9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda
`;

try {
  await writeFile(output, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write('Created private .env with random SekerEagle-only secrets\n');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    throw new Error('.env already exists; refusing to overwrite it', { cause: error });
  }
  throw error;
}
