import type { EagleMediaJobKind } from '@prisma/client';
import sharp from 'sharp';
import { isCameraRawMime } from '@sekereagle/library-core';
import { withProcessableImage } from './image-media';
import { renderImageRenditions, imageRenditionSpecs } from './image-renditions';
import { analyzePhotoPixels, readPhotoExif } from './photo-analysis';
import { extractRepresentativeColors } from './color-palette';
import { inspectLivePhotoImage } from './live-photo';
import { taskBlocksAssetReady } from './processing-policy';
import { IMAGE_WORK_MAX_RESPONSE_BYTES, imageWorkResponseLimit } from './image-work-budget';
export { IMAGE_WORK_MAX_RESPONSE_BYTES } from './image-work-budget';
export interface ImageWork {
  assetMimeType: string;
  sourceMimeType: string;
  sourceExtension?: string;
  kind: EagleMediaJobKind;
  processorVersion?: string;
  mode: 'PHOTO' | 'MATERIAL';
  detailsOnly: boolean;
  verifiesOriginalHash: boolean;
}
export function validateImageWork(work: ImageWork) {
  if (
    !work ||
    !['PHOTO', 'MATERIAL'].includes(work.mode) ||
    (work.sourceExtension !== undefined && !['.heic', '.heif'].includes(work.sourceExtension)) ||
    typeof work.detailsOnly !== 'boolean' ||
    typeof work.verifiesOriginalHash !== 'boolean' ||
    typeof work.assetMimeType !== 'string' ||
    !work.assetMimeType.startsWith('image/') ||
    work.assetMimeType.length > 100 ||
    typeof work.sourceMimeType !== 'string' ||
    !work.sourceMimeType.startsWith('image/') ||
    work.sourceMimeType.length > 100 ||
    ![
      'GENERATE_RENDITIONS',
      'GENERATE_THUMBNAIL',
      'GENERATE_PREVIEW',
      'PROBE_MEDIA',
      'EXTRACT_COLOR_PALETTE',
    ].includes(work.kind)
  )
    throw new Error('INVALID_IMAGE_WORK');
  return work;
}
export async function processImageWork(source: AsyncIterable<Uint8Array>, work: ImageWork) {
  validateImageWork(work);
  const deferDetails =
    !work.detailsOnly && (isCameraRawMime(work.assetMimeType) || work.mode === 'PHOTO');
  return withProcessableImage(
    source,
    work.sourceMimeType,
    'input' + (work.sourceExtension ?? ''),
    async (source, originalPath, originalDimensions) => {
      const metadataPromise = source.clone().metadata();
      if (work.kind === 'EXTRACT_COLOR_PALETTE') {
        const [{ data, info }, metadata] = await Promise.all([
          source
            .clone()
            .rotate()
            .toColourspace('srgb')
            .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
          metadataPromise,
        ]);
        return {
          metadata,
          palette: extractRepresentativeColors(data, info.channels, info.width * info.height, 6),
          rendered: null,
        };
      }
      const metadata = await metadataPromise;
      const rendered = await renderImageRenditions(
        source,
        work.assetMimeType,
        work.detailsOnly ? 'DETAILS' : 'BROWSE',
      );
      const photoAnalysis =
        work.mode === 'PHOTO'
          ? {
              ...(!work.detailsOnly ? await readPhotoExif(metadata.exif, originalPath) : {}),
              ...(work.detailsOnly
                ? {
                    ...(await analyzePhotoPixels(source)),
                    ...(!work.verifiesOriginalHash
                      ? { processorVersion: 'preview-laplacian-dhash-v3' }
                      : {}),
                  }
                : {}),
            }
          : null;
      const livePhoto =
        originalPath && (work.detailsOnly || !deferDetails)
          ? await inspectLivePhotoImage(originalPath)
          : null;
      return { metadata, originalDimensions, palette: null, rendered, photoAnalysis, livePhoto };
    },
    work.verifiesOriginalHash &&
      (taskBlocksAssetReady(work.kind, work.processorVersion ?? 'rendition-v2') ||
        work.detailsOnly),
    work.detailsOnly ? 'DEVELOP' : 'BROWSE',
  );
}
export type ImageWorkResult = Awaited<ReturnType<typeof processImageWork>>;
export const IMAGE_WORK_CONTENT_TYPE = 'application/vnd.sekereagle.image-work';
export function encodeImageWork(
  value: ImageWorkResult,
  work?: Pick<ImageWork, 'kind' | 'mode' | 'detailsOnly'>,
) {
  const limit = work ? imageWorkResponseLimit(work) : IMAGE_WORK_MAX_RESPONSE_BYTES;
  const buffers: Buffer[] = [];
  let offset = 0;
  function pack(input: unknown): unknown {
    if (Buffer.isBuffer(input)) {
      const ref = { $binary: [offset, input.length] };
      offset += input.length;
      if (offset > limit) throw new Error('IMAGE_RESULT_TOO_LARGE');
      buffers.push(input);
      return ref;
    }
    if (input instanceof Date) return { $date: input.toISOString() };
    if (Array.isArray(input)) return input.map(pack);
    if (input && typeof input === 'object')
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, pack(v)]));
    return input;
  }
  const metadata = Buffer.from(JSON.stringify(pack(value)));
  if (metadata.length > 1024 * 1024 || 8 + metadata.length + offset > limit)
    throw new Error('IMAGE_RESULT_TOO_LARGE');
  const header = Buffer.alloc(8);
  header.write('SEI1');
  header.writeUInt32BE(metadata.length, 4);
  return Buffer.concat([header, metadata, ...buffers]);
}
export async function decodeImageWork(bytes: Buffer, work: ImageWork): Promise<ImageWorkResult> {
  if (
    bytes.length < 8 ||
    bytes.length > imageWorkResponseLimit(work) ||
    bytes.toString('ascii', 0, 4) !== 'SEI1'
  )
    throw new Error('INVALID_IMAGE_RESULT');
  const metadataLength = bytes.readUInt32BE(4);
  if (metadataLength > 1024 * 1024 || 8 + metadataLength > bytes.length)
    throw new Error('INVALID_IMAGE_RESULT');
  const data = bytes.subarray(8 + metadataLength);
  const value = JSON.parse(
    bytes.toString('utf8', 8, 8 + metadataLength),
    (key: string, v: unknown): unknown => {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('INVALID_IMAGE_RESULT');
      if (v && typeof v === 'object' && '$binary' in v) {
        const ref = v.$binary;
        if (
          Object.keys(v).length !== 1 ||
          !Array.isArray(ref) ||
          ref.length !== 2 ||
          !ref.every(Number.isSafeInteger) ||
          ref[0] < 0 ||
          ref[1] < 0 ||
          ref[1] > 128 * 1024 * 1024 ||
          ref[0] + ref[1] > data.length
        )
          throw new Error('INVALID_IMAGE_RESULT');
        return data.subarray(Number(ref[0]), Number(ref[0]) + Number(ref[1]));
      }
      if (v && typeof v === 'object' && '$date' in v) {
        if (Object.keys(v).length !== 1 || typeof v.$date !== 'string')
          throw new Error('INVALID_IMAGE_RESULT');
        const d = new Date(v.$date);
        if (!Number.isFinite(d.getTime())) throw new Error('INVALID_IMAGE_RESULT');
        return d;
      }
      return v;
    },
  ) as ImageWorkResult;
  if (
    !value ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !['IMAGE', 'RAW_EMBEDDED', 'RAW_DEVELOPED'].includes(value.sourceMode) ||
    !value.result ||
    typeof value.result.metadata !== 'object'
  )
    throw new Error('INVALID_IMAGE_RESULT');
  for (const dimensions of [
    value.result.metadata,
    value.result.metadata.autoOrient,
    'originalDimensions' in value.result ? value.result.originalDimensions : undefined,
  ]) {
    if (
      dimensions &&
      (!Number.isInteger(dimensions.width) ||
        !Number.isInteger(dimensions.height) ||
        Number(dimensions.width) < 1 ||
        Number(dimensions.height) < 1 ||
        Number(dimensions.width) * Number(dimensions.height) > 120000000)
    )
      throw new Error('INVALID_IMAGE_RESULT');
  }
  if (
    'livePhoto' in value.result &&
    value.result.livePhoto?.identifier != null &&
    (typeof value.result.livePhoto.identifier !== 'string' ||
      value.result.livePhoto.identifier.length > 1024)
  )
    throw new Error('INVALID_IMAGE_RESULT');
  if ('livePhoto' in value.result && value.result.livePhoto?.motion) {
    const motion = value.result.livePhoto.motion;
    if (
      !Buffer.isBuffer(motion.data) ||
      motion.data.length > 64 * 1024 * 1024 ||
      !Number.isInteger(motion.width) ||
      !Number.isInteger(motion.height) ||
      motion.width < 1 ||
      motion.height < 1 ||
      motion.width * motion.height > 120000000
    )
      throw new Error('INVALID_IMAGE_RESULT');
  }
  const specs =
    work.kind === 'EXTRACT_COLOR_PALETTE'
      ? []
      : imageRenditionSpecs(work.assetMimeType, work.detailsOnly ? 'DETAILS' : 'BROWSE');
  const rendered = value.result.rendered ?? [];
  if (!Array.isArray(rendered) || rendered.length !== specs.length)
    throw new Error('INVALID_IMAGE_RESULT');
  for (let i = 0; i < specs.length; i++) {
    const entry = rendered[i]!,
      spec = specs[i]!;
    if (
      entry.spec.kind !== spec.kind ||
      entry.spec.variant !== spec.variant ||
      !Buffer.isBuffer(entry.output.data) ||
      entry.output.data.length > 128 * 1024 * 1024
    )
      throw new Error('INVALID_IMAGE_RESULT');
    const metadata = await sharp(entry.output.data, { limitInputPixels: 120000000 }).metadata();
    if (
      metadata.format !== 'webp' ||
      metadata.width !== entry.output.info.width ||
      metadata.height !== entry.output.info.height ||
      Math.max(metadata.width, metadata.height) > spec.maxSize
    )
      throw new Error('INVALID_IMAGE_RESULT');
    entry.spec = spec;
  }
  if (value.result.palette) {
    if (!Array.isArray(value.result.palette) || value.result.palette.length > 6)
      throw new Error('INVALID_IMAGE_RESULT');
    value.result.palette = value.result.palette.map((s) => {
      if (
        !/^#[a-fA-F0-9]{6}$/.test(s.hex) ||
        ![s.weight, s.labL, s.labA, s.labB].every(Number.isFinite) ||
        s.weight < 0 ||
        s.weight > 1
      )
        throw new Error('INVALID_IMAGE_RESULT');
      return { hex: s.hex, weight: s.weight, labL: s.labL, labA: s.labA, labB: s.labB };
    });
  }
  if ('photoAnalysis' in value.result && value.result.photoAnalysis) {
    const keys = [
      'processorVersion',
      'capturedAt',
      'capturedLocal',
      'captureTimeZoneKnown',
      'cameraMake',
      'cameraModel',
      'lensModel',
      'focalLength',
      'aperture',
      'exposureSeconds',
      'iso',
      'latitude',
      'longitude',
      'altitude',
      'sharpnessScore',
      'perceptualHash',
      'blurScore',
      'brightnessScore',
      'contrastScore',
    ];
    const strings = [
      'processorVersion',
      'capturedLocal',
      'cameraMake',
      'cameraModel',
      'lensModel',
      'perceptualHash',
    ];
    for (const [key, item] of Object.entries(value.result.photoAnalysis)) {
      if (!keys.includes(key) || item == null) continue;
      const valid = strings.includes(key)
        ? typeof item === 'string' && item.length <= 240
        : key === 'capturedAt'
          ? item instanceof Date && Number.isFinite(item.getTime())
          : key === 'captureTimeZoneKnown'
            ? typeof item === 'boolean'
            : typeof item === 'number' &&
              Number.isFinite(item) &&
              Math.abs(item) <= 1e9 &&
              (key !== 'iso' || Number.isInteger(item)) &&
              (key === 'latitude'
                ? Math.abs(item) <= 90
                : key === 'longitude'
                  ? Math.abs(item) <= 180
                  : key === 'altitude'
                    ? item >= -12000 && item <= 100000
                    : item >= 0);
      if (!valid) throw new Error('INVALID_IMAGE_RESULT');
    }
    value.result.photoAnalysis = Object.fromEntries(
      Object.entries(value.result.photoAnalysis).filter(([k]) => keys.includes(k)),
    );
  }
  return value;
}
