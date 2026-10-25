import type { GetObjectCommandInput, GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { LIVE_PHOTO_MAX_VIDEO_BYTES } from '@sekereagle/media-core';

/** Validate both the owner key and exact S3 range response; a server ignoring Range must fail closed. */
export async function readOwnedImageRange(
  send: (input: GetObjectCommandInput) => Promise<GetObjectCommandOutput>,
  source: { bucket: string; ownerId: string; key: string; byteSize: number },
  start: number,
  length: number,
) {
  if (
    !source.key.startsWith(`users/${source.ownerId}/assets/`) ||
    !Number.isSafeInteger(source.byteSize) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 1 ||
    length > LIVE_PHOTO_MAX_VIDEO_BYTES ||
    start + length > source.byteSize
  )
    throw new Error('IMAGE_RANGE_SCOPE');
  const end = start + length - 1;
  const object = await send({
    Bucket: source.bucket,
    Key: source.key,
    Range: `bytes=${start}-${end}`,
  });
  try {
    if (
      !object.Body ||
      object.ContentRange !== `bytes ${start}-${end}/${source.byteSize}` ||
      object.ContentLength !== length
    )
      throw new Error('IMAGE_RANGE_RESPONSE');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > length) throw new Error('IMAGE_RANGE_LENGTH');
      chunks.push(Buffer.from(chunk));
    }
    if (bytes !== length) throw new Error('IMAGE_RANGE_LENGTH');
    return Buffer.concat(chunks, bytes);
  } finally {
    const stream = object.Body as { destroy?: () => void } | undefined;
    stream?.destroy?.();
  }
}
