import { parse } from 'exifr';
import type { Sharp } from 'sharp';

export const PHOTO_ANALYSIS_VERSION = 'exifr-7.1.3-laplacian-dhash-v1';
const text = (value: unknown) =>
  typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, 240) || null : null;
const numeric = (value: unknown, min = 0, max = 1e9) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;

/** EXIF wall-clock dates have no timezone unless OffsetTimeOriginal is supplied. */
export function normalizePhotoExif(exif: Record<string, unknown>) {
  const raw = text(exif.DateTimeOriginal);
  const match = raw?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  const offset = text(exif.OffsetTimeOriginal);
  const known = Boolean(offset && /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset));
  let capturedAt: Date | null = null;
  let capturedLocal: string | null = null;
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const wall = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const check = new Date(`${wall}Z`);
    if (
      Number(year) >= 1800 &&
      Number(year) <= 2200 &&
      Number.isFinite(check.getTime()) &&
      check.toISOString().slice(0, 19) === wall
    ) {
      capturedAt = new Date(`${wall}${known ? offset : 'Z'}`);
      capturedLocal = wall;
    }
  }
  const latitude = numeric(exif.latitude, -90, 90),
    longitude = numeric(exif.longitude, -180, 180);
  return {
    capturedAt,
    capturedLocal,
    captureTimeZoneKnown: capturedAt !== null && known,
    cameraMake: text(exif.Make),
    cameraModel: text(exif.Model),
    lensModel: text(exif.LensModel),
    focalLength: numeric(exif.FocalLength),
    aperture: numeric(exif.FNumber),
    exposureSeconds: numeric(exif.ExposureTime),
    iso: Number.isInteger(exif.ISO) ? numeric(exif.ISO, 1, 1e7) : null,
    latitude: longitude !== null ? latitude : null,
    longitude: latitude !== null ? longitude : null,
    altitude: numeric(exif.GPSAltitude, -12000, 100000),
  };
}

export async function readPhotoExif(exif?: Buffer, originalPath?: string) {
  let tags: Record<string, unknown> = {};
  if ((exif && exif.length <= 1024 * 1024) || (!exif && originalPath)) {
    try {
      const value: unknown = await parse(
        exif
          ? exif.subarray(0, 6).equals(Buffer.from('Exif\0\0'))
            ? exif.subarray(6)
            : exif
          : originalPath!,
        {
          chunkSize: 65536,
          chunkLimit: 32,
          reviveValues: false,
          makerNote: false,
          userComment: false,
          xmp: false,
          icc: false,
          iptc: false,
        },
      );
      if (value && typeof value === 'object') tags = value as Record<string, unknown>;
    } catch {
      /* Broken optional metadata must not prevent preview generation. */
    }
  }
  return normalizePhotoExif(tags);
}

export async function analyzePhotoPixels(image: Sharp) {
  const { data, info } = await image
    .clone()
    .rotate()
    .resize(128, 128, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let total = 0,
    squared = 0,
    count = 0;
  for (let y = 1; y < info.height - 1; y++)
    for (let x = 1; x < info.width - 1; x++) {
      const p = y * info.width + x;
      const laplacian =
        4 * data[p]! - data[p - 1]! - data[p + 1]! - data[p - info.width]! - data[p + info.width]!;
      total += laplacian;
      squared += laplacian * laplacian;
      count++;
    }
  const hashData = await image
    .clone()
    .rotate()
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      hash = (hash << 1n) | (hashData[y * 9 + x]! > hashData[y * 9 + x + 1]! ? 1n : 0n);
  return {
    sharpnessScore: Math.max(0, squared / count - (total / count) ** 2),
    perceptualHash: hash.toString(16).padStart(16, '0'),
  };
}
