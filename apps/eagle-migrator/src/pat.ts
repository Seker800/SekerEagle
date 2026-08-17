export const SEKER_EAGLE_PAT_PREFIX = 'sea_pat_';

export function isSekerEaglePat(value: string | undefined): value is string {
  return Boolean(value?.startsWith(SEKER_EAGLE_PAT_PREFIX));
}
