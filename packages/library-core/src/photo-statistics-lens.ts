/** Opaque statistics identities keep real lenses distinct from device fallbacks. */
export type PhotoLensIdentity = readonly [kind: 'lens' | 'camera' | 'unknown', name: string];
export function parsePhotoLensKey(key: string): PhotoLensIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      ['lens', 'camera', 'unknown'].includes(value[0]) &&
      typeof value[1] === 'string' &&
      (value[0] === 'unknown' ? value[1] === '' : value[1].length > 0)
    )
      return value as unknown as PhotoLensIdentity;
  } catch {
    /* Legacy servers return plain lens model names. */
  }
  return null;
}
