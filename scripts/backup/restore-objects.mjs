// Run only after verifying/extracting the archive, into an EMPTY Eagle bucket.
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
const require = createRequire('/sekereagle/apps/api/package.json');
const { assertSafeRuntimeTarget } = require('@sekereagle/config');
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
if (!['sekereagle-assets', 'sekereagle-test-assets'].includes(process.env.S3_BUCKET))
  throw new Error('Unexpected restore bucket');
const root = '/restore';
const manifest = JSON.parse(await readFile(root + '/manifest.json', 'utf8'));
if (manifest.formatVersion !== 1 || !Array.isArray(manifest.objects))
  throw new Error('Invalid restore manifest');
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
try {
  const existing = await client.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, MaxKeys: 1 }),
  );
  if (existing.Contents?.length) throw new Error('Restore bucket must be empty');
  for (const object of manifest.objects) {
    const path = resolve(root, 'objects', object.key);
    if (
      typeof object.key !== 'string' ||
      !path.startsWith(resolve(root, 'objects') + sep) ||
      object.key.split('/').some((part) => ['', '.', '..'].includes(part)) ||
      object.key.includes('\\')
    )
      throw new Error('Unsafe object key');
    if ((await stat(path)).size !== object.size) throw new Error('Restore object size mismatch');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== object.sha256) throw new Error('Restore object hash mismatch');
    const metadata = object.metadata ?? {};
    // Explicit allow-list prevents archive fields from replacing the destination.
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: object.key,
        Body: createReadStream(path),
        ContentLength: object.size,
        ContentType: metadata.ContentType,
        CacheControl: metadata.CacheControl,
        ContentDisposition: metadata.ContentDisposition,
        ContentEncoding: metadata.ContentEncoding,
        ContentLanguage: metadata.ContentLanguage,
        Metadata: metadata.Metadata,
        Expires: metadata.Expires ? new Date(metadata.Expires) : undefined,
      }),
    );
  }
  process.stdout.write(`Restored ${manifest.objects.length} Eagle objects.\n`);
} finally {
  client.destroy();
}
