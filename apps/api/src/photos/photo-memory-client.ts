import { requestLibraryRead, libraryReadMetrics } from '../eagle/eagle-memory-client';
import { memoryStatisticsSummary, memoryPersonCounts, memoryPhotoFacets } from '../eagle/eagle-memory-protocol';
import type { PhotoStatisticsQueryDto } from './photo-statistics.dto';

export async function readMemoryStatistics(
  ownerId: string,
  includePrivate: boolean,
  statistics: PhotoStatisticsQueryDto,
) {
  const result = await requestLibraryRead(
    { ownerId, libraryMode: 'PHOTO' },
    { action: 'statistics', includePrivate, statistics },
  );
  if (!result) return null;
  const parsed = memoryStatisticsSummary.safeParse(result.summary);
  if (!parsed.success) return null;
  libraryReadMetrics.hits++;
  return parsed.data;
}

export async function readMemoryPeopleCounts(ownerId: string, includePrivate: boolean) {
  const result = await requestLibraryRead(
    { ownerId, libraryMode: 'PHOTO' },
    { action: 'peopleCounts', includePrivate },
  );
  if (!result || typeof result.revision !== 'string' || !/^\d+$/.test(result.revision)) return null;
  const parsed = memoryPersonCounts.safeParse(result.counts);
  if (!parsed.success || new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length)
    return null;
  libraryReadMetrics.hits++;
  return { revision: result.revision, counts: parsed.data };
}

export async function readMemoryPhotoFacets(ownerId: string, includePrivate: boolean) {
  const result = await requestLibraryRead({ ownerId, libraryMode: 'PHOTO' }, { action: 'facets', includePrivate });
  if (!result) return null;
  const parsed = memoryPhotoFacets.safeParse(result.facets);
  if (!parsed.success) return null;
  libraryReadMetrics.hits++;
  return parsed.data;
}
