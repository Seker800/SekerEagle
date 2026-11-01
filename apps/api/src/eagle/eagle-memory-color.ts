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
  const positions: MemoryColorPosition[] = [];
  const compare = (a: { id: string; score: number; time: string }, b: { id: string; score: number; time: string }) =>
    a.score - b.score || Date.parse(b.time) - Date.parse(a.time) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  index.forEach(options.where, row => {
    const position = { id: String(row.id), score: score(row, options.color) || 100,
      time: new Date(memoryDateTime(row[options.date])).toISOString(), mediaRevision: Number(row.mediaRevision) };
    if (options.after && (options.after.newer ? compare(position, options.after) >= 0 : compare(position, options.after) <= 0)) return;
    positions.push(position);
  }, context);
  positions.sort((a, b) => options.after?.newer ? -compare(a, b) : compare(a, b));
  return positions.slice(options.offset, options.offset + options.limit + 1);
}
