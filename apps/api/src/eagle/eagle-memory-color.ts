import type { LibraryMemoryIndex, MemoryDateField } from './eagle-memory-index';
import { memoryDateTime } from './eagle-memory-index';
import type { AssetSearchWhere } from './eagle-search-predicate';
import type { MemorySearchContext } from './eagle-memory-predicate';
import { createMemoryColorScorer } from './eagle-memory-color-score';
export { createMemoryColorScorer } from './eagle-memory-color-score';

export interface MemoryColorPosition { id: string; score: number; time: string; mediaRevision: number }
export interface MemoryColorPageOptions {
  where: AssetSearchWhere; color: string; date: MemoryDateField; limit: number; offset: number;
  after?: { id: string; score: number; time: string; newer?: true };
}
/** Preserve Eagle's score-or-100 order and the existing SQL cursor's inverse traversal. */
export function residentColorPage(index: LibraryMemoryIndex, options: MemoryColorPageOptions, context?: MemorySearchContext): MemoryColorPosition[] {
  const score = createMemoryColorScorer();
  const positions: Array<Omit<MemoryColorPosition, 'time'> & { time: number }> = [];
  const after = options.after ? { ...options.after, time: Date.parse(options.after.time) } : undefined;
  const compare = (a: { id: string; score: number; time: number }, b: { id: string; score: number; time: number }) =>
    a.score - b.score || b.time - a.time || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  index.forEach(options.where, row => {
    const position = { id: String(row.id), score: score(row, options.color) || 100,
      time: memoryDateTime(row[options.date]), mediaRevision: Number(row.mediaRevision) };
    if (after && (after.newer ? compare(position, after) >= 0 : compare(position, after) <= 0)) return;
    positions.push(position);
  }, context);
  positions.sort((a, b) => options.after?.newer ? -compare(a, b) : compare(a, b));
  return positions.slice(options.offset, options.offset + options.limit + 1).map(row => ({ ...row, time: new Date(row.time).toISOString() }));
}
