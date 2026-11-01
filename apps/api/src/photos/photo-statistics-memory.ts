import type { LibraryMemoryIndex } from '../eagle/eagle-memory-index';
import { Prisma } from '@prisma/client';
import type { Pool } from 'pg';
import type { PhotoStatisticsQueryDto } from './photo-statistics.dto';
import type { Summary } from './photo-statistics.service';
import { photoStatisticsSql } from './photo-statistics-query';

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

/** Preserve the original grouping/ranking/collation SQL, with only a compact daily source. */
export async function readResidentPhotoStatistics(
  pool: Pool,
  index: LibraryMemoryIndex,
  includePrivate: boolean,
  query: PhotoStatisticsQueryDto,
): Promise<Summary> {
  const facts = residentStatisticsDaily(index, includePrivate);
  const source = Prisma.sql`SELECT * FROM jsonb_to_recordset(${JSON.stringify(facts)}::jsonb) AS facts(camera text,raw_lens text,lens_device text,day text,n int)`;
  const sql = photoStatisticsSql(index.ownerId, includePrivate, query, source);
  const result = await pool.query<Summary>(sql.text, sql.values);
  return result.rows[0]!;
}
