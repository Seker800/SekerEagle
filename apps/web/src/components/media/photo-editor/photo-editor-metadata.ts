import type { PhotoMetadata } from './photo-watermark-model';

const TAGS = [
  'Make',
  'Model',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'FNumber',
  'ExposureTime',
  'ISO',
  'DateTimeOriginal',
];
const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
const number = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

export function formatPhotoMetadata(data: Record<string, unknown> | undefined): PhotoMetadata {
  if (!data) return {};
  const make = text(data.Make).replace(/\s+(corporation|corp\.?|inc\.?)$/i, ''),
    model = text(data.Model);
  const camera = model.toLowerCase().startsWith(make.toLowerCase())
    ? model
    : [make, model].filter(Boolean).join(' ');
  const focal = number(data.FocalLengthIn35mmFormat) ?? number(data.FocalLength);
  const aperture = number(data.FNumber),
    exposure = number(data.ExposureTime),
    iso = number(data.ISO);
  const parameters = [
    focal ? `${Math.round(focal * 10) / 10}mm` : '',
    aperture ? `f/${aperture}` : '',
    exposure ? (exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`) : '',
    iso ? `ISO ${iso}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  const date = data.DateTimeOriginal;
  const capturedAt =
    date instanceof Date && Number.isFinite(date.getTime())
      ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      : undefined;
  return { camera: camera || undefined, parameters: parameters || undefined, capturedAt };
}

/** Only photography fields are read. Missing EXIF remains missing; GPS is never parsed. */
export async function readPhotoMetadata(
  source: string,
  signal: AbortSignal,
): Promise<PhotoMetadata> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await fetch(source, { signal: boundedSignal, credentials: 'same-origin' });
  if (!response.ok) return {};
  const { parse } = await import('exifr');
  const data: unknown = await parse(await response.blob(), {
    pick: TAGS,
    gps: false,
    xmp: false,
    iptc: false,
    icc: false,
  });
  if (signal.aborted) return {};
  return formatPhotoMetadata(
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined,
  );
}
