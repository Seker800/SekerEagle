import type { LibraryMemoryIndex } from '../eagle/eagle-memory-index';

export interface StatisticsDailyFact {
  camera: string;
  raw_lens: string;
  lens_device: string;
  day: string | null;
  n: number;
}
const unknownFact = { camera: '', raw_lens: '', lens_device: '', day: null };

/** Counts the existing SQL-defined daily facts; date/device semantics stay in SQL. */
export function residentStatisticsDaily(
  index: LibraryMemoryIndex,
  includePrivate: boolean,
): StatisticsDailyFact[] {
  if (index.libraryMode !== 'PHOTO') throw new Error('Unsupported statistics library');
  return index.derive(
    `photo-statistics:${includePrivate ? 'private' : 'public'}`,
    ['statisticsFact', 'isPrivate', 'deletedAt', 'mimeType'],
    () => {
      const daily = new Map<string, StatisticsDailyFact>();
      index.forEach(
        {
          deletedAt: null,
          mimeType: { startsWith: 'image/' },
          ...(includePrivate ? {} : { isPrivate: false }),
        },
        (row) => {
          const fact = (row.statisticsFact ?? unknownFact) as Omit<StatisticsDailyFact, 'n'>;
          const key = JSON.stringify(fact);
          const previous = daily.get(key);
          if (previous) previous.n++;
          else daily.set(key, { ...fact, n: 1 });
        },
      );
      return [...daily.values()];
    },
  );
}
