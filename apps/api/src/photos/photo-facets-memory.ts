import type { Pool } from 'pg';
import type { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import type { MemoryAsset } from '../eagle/eagle-memory-predicate';

export interface PhotoReadFacets { cameras: string[]; lenses: string[] }
/** Facets deliberately retain raw values; chart labels use a different, trimmed contract. */
export function residentPhotoFacets(index: LibraryMemoryIndex, includePrivate: boolean): PhotoReadFacets {
  return index.derive(`photo-facets:${includePrivate}`, ['photoMetadata', 'isPrivate', 'deletedAt'], () => {
    const cameras = new Set<string>(), lenses = new Set<string>();
    index.forEach({ deletedAt: null, ...(includePrivate ? {} : { isPrivate: false }) }, row => {
      const metadata = row.photoMetadata as MemoryAsset | null;
      if (typeof metadata?.cameraModel === 'string' && metadata.cameraModel) cameras.add(metadata.cameraModel);
      if (typeof metadata?.lensModel === 'string' && metadata.lensModel) lenses.add(metadata.lensModel);
    });
    return { cameras: [...cameras], lenses: [...lenses] };
  });
}
export async function readResidentPhotoFacets(pool: Pool, index: LibraryMemoryIndex, includePrivate: boolean): Promise<PhotoReadFacets> {
  const values = residentPhotoFacets(index, includePrivate);
  // Preserve the database collation instead of introducing JavaScript locale ordering.
  const result = await pool.query<{ facets: PhotoReadFacets }>(`
    SELECT jsonb_build_object(
      'cameras', COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text($1::jsonb) AS t(value)), '[]'::jsonb),
      'lenses', COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text($2::jsonb) AS t(value)), '[]'::jsonb)
    ) AS facets`, [JSON.stringify(values.cameras), JSON.stringify(values.lenses)]);
  return result.rows[0]!.facets;
}
