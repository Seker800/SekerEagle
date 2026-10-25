export type MediaQueueAge = 'RECENT' | 'HISTORY';

/** Classify by asset ingestion, never by a maintenance job's creation timestamp. */
export function mediaQueueAgeOrder(sequence: number): Array<MediaQueueAge | undefined> {
  return sequence % 16 === 15 ? ['HISTORY', 'RECENT', undefined] : ['RECENT', undefined];
}
