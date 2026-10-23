import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { mediaSubprocessEnvironment } from './subprocess-environment';
const run = promisify(execFile);
function singleRecord(text: string): Record<string, unknown> {
  const records: unknown = JSON.parse(text);
  if (!Array.isArray(records) || records.length !== 1)
    throw new Error('Invalid photo metadata response');
  const value: unknown = records[0];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid photo metadata response');
  return value as Record<string, unknown>;
}
const fields = [
  'ImageWidth',
  'ImageHeight',
  'ExifImageWidth',
  'ExifImageHeight',
  'Orientation',
  'Rotation',
  'Make',
  'Model',
  'LensModel',
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'FocalLength',
  'FNumber',
  'ExposureTime',
  'ISO',
  'GPSLatitude',
  'GPSLongitude',
  'GPSLatitudeRef',
  'GPSLongitudeRef',
  'GPSAltitude',
  'GPSAltitudeRef',
] as const;

/** Read only selected original-file tags; never render pixels or write metadata. */
export async function readPhotoMetadataTags(
  originalPath: string,
): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      process.env.EXIFTOOL_PATH?.trim() || 'exiftool',
      ['-json', '-n', ...fields.map((field) => `-${field}`), '--', resolve(originalPath)],
      { env: mediaSubprocessEnvironment(), timeout: 30_000, maxBuffer: 256 * 1024 },
    ));
  } catch (error) {
    // ExifTool emits a bounded JSON Error record for an unreadable optional metadata container.
    const failure = error as { code?: unknown; stdout?: unknown };
    if (failure.code !== 1 || typeof failure.stdout !== 'string') throw error;
    if (singleRecord(failure.stdout).Error) return {};
    throw error;
  }
  const source = singleRecord(stdout);
  const tags: Record<string, unknown> = {};
  for (const field of fields) if (source[field] !== undefined) tags[field] = source[field];
  for (const [coordinate, ref, output, negative] of [
    ['GPSLatitude', 'GPSLatitudeRef', 'latitude', 'S'],
    ['GPSLongitude', 'GPSLongitudeRef', 'longitude', 'W'],
  ] as const) {
    const value = tags[coordinate];
    if (typeof value === 'number' && Number.isFinite(value))
      tags[output] = Math.abs(value) * (tags[ref] === negative ? -1 : 1);
  }
  if (typeof tags.GPSAltitude === 'number' && tags.GPSAltitudeRef === 1)
    tags.GPSAltitude = -Math.abs(tags.GPSAltitude);
  return tags;
}
