const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const LIBRARY_READ = new RegExp(`^/api/(eagle|photos)/(?:assets(?:/${UUID})?|trash)$`, 'i');

/** Shared by preload and main. No arbitrary fetch, credentials, headers or writes. */
export function isLibraryReadPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.includes('#') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return false;
  const pathname = value.split('?', 1)[0]!;
  return pathname === '/api/library/changes' || LIBRARY_READ.test(pathname);
}
export interface LibraryReadResponse {
  status: number;
  body: string;
  contentType: string;
}
