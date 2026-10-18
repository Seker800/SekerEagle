export type LibraryMode = 'MATERIAL' | 'PHOTO';

/** Explicit immutable request scope; authentication remains shared. */
export function libraryApiPath(path: string, libraryMode: LibraryMode): string {
  if (libraryMode === 'MATERIAL') return path;
  return path
    .replace(/^\/api\/auth\/privacy-visibility(?=$|\?)/, '/api/photos/privacy-visibility')
    .replace(/^\/api\/admin\/eagle-processing(?=$|[/?])/, '/api/admin/photo-processing')
    .replace(/^\/api\/eagle(?=$|[/?])/, '/api/photos');
}
