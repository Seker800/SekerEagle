/** Capture facts belong to the original exposure; pixel measurements belong to each rendition. */
const CAPTURE_FIELDS = [
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
] as const;
export function photoCaptureMetadata<T extends object>(metadata: T) {
  return Object.fromEntries(
    CAPTURE_FIELDS.filter((key) => key in metadata).map((key) => [key, metadata[key as keyof T]]),
  ) as Pick<T, Extract<keyof T, (typeof CAPTURE_FIELDS)[number]>>;
}
