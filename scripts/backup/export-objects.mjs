// Runs in a disposable API-image container, against the isolated Eagle network.
// JSON header + exact-length bytes is only a local pipe into the tar producer.
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire('/sekereagle/apps/api/package.json');
const { assertSafeRuntimeTarget } = require('@sekereagle/config');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
if (process.env.S3_BUCKET !== 'sekereagle-assets') throw new Error('Unexpected backup bucket');
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  maxAttempts: 4,
});
async function write(chunk) {
  if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
}
let token;
let count = 0;
let bytes = 0;
try {
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        ContinuationToken: token,
      }),
    );
    const objects = page.Contents ?? [];
    // Bounded look-ahead hides request latency without buffering whole objects.
    for (let offset = 0; offset < objects.length; offset += 8) {
      const batch = objects.slice(offset, offset + 8);
      const results = await Promise.all(
        batch.map((object) =>
          client.send(
            new GetObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: object.Key,
              IfMatch: object.ETag,
            }),
          ),
        ),
      );
      for (let index = 0; index < batch.length; index += 1) {
        const object = batch[index];
        const response = results[index];
        const metadata = Object.fromEntries(
          [
            'ContentType',
            'CacheControl',
            'ContentDisposition',
            'ContentEncoding',
            'ContentLanguage',
            'Metadata',
            'Expires',
          ]
            .filter((key) => response[key] !== undefined)
            .map((key) => [key, response[key]]),
        );
        if (!response.Body || response.ContentLength !== object.Size)
          throw new Error('Object changed during backup');
        await write(JSON.stringify({ key: object.Key, size: object.Size, metadata }) + '\n');
        let transferred = 0;
        for await (const chunk of response.Body) {
          transferred += chunk.length;
          await write(chunk);
        }
        if (transferred !== object.Size) throw new Error('Incomplete object read');
        count += 1;
        bytes += transferred;
      }
    }
    token = page.NextContinuationToken;
    if (page.IsTruncated && !token) throw new Error('Incomplete bucket listing');
  } while (token);
  await write(JSON.stringify({ complete: true, count, bytes }) + '\n');
} catch {
  // Never include SDK errors (which can contain request credentials) in host logs.
  process.stderr.write('Eagle object export failed; backup must be discarded.\n');
  process.exitCode = 1;
} finally {
  client.destroy();
}
