import { compileMemorySearchPredicate, type MemoryAsset } from './eagle-memory-predicate';
import type { AssetSearchWhere } from './eagle-search-predicate';

export type MemoryDateField = 'libraryAddedAt' | 'chronologicalAt';
/** One library's derived information. Like Eagle, sort once and filter the resident array.
 * No business writes, timers, global user state or independent rule language.
 */
export class LibraryMemoryIndex {
  revision = '0';
  private rows = new Map<string, MemoryAsset>();
  private ordered = new Map<MemoryDateField, MemoryAsset[]>();
  constructor(
    readonly ownerId: string,
    readonly libraryMode: string,
  ) {}

  private validate(revision: string, rows: MemoryAsset[]) {
    if (BigInt(revision) < BigInt(this.revision)) throw new Error('Stale library read revision');
    for (const row of rows) {
      if (
        row.ownerId !== this.ownerId ||
        row.libraryMode !== this.libraryMode ||
        typeof row.id !== 'string'
      )
        throw new Error('Library read scope mismatch');
      for (const key of ['libraryAddedAt', 'chronologicalAt']) {
        if (!Number.isFinite(new Date(String(row[key])).getTime()))
          throw new Error('Invalid library read date');
      }
    }
  }
  replace(revision: string, rows: MemoryAsset[]) {
    this.validate(revision, rows);
    this.rows = new Map(rows.map((row) => [row.id as string, row]));
    this.revision = revision;
    this.ordered.clear();
  }
  update(revision: string, ids: string[], rows: MemoryAsset[]) {
    this.validate(revision, rows);
    for (const id of ids) this.rows.delete(id);
    for (const row of rows) this.rows.set(row.id as string, row);
    this.revision = revision;
    this.ordered.clear();
  }
  private predicate(where: AssetSearchWhere) {
    return compileMemorySearchPredicate({
      AND: [
        { ownerId: this.ownerId, libraryMode: this.libraryMode as 'PHOTO' | 'MATERIAL' },
        where,
      ],
    });
  }
  page(
    where: AssetSearchWhere,
    date: MemoryDateField,
    direction: 'asc' | 'desc',
    take: number,
    skip: number,
  ): string[] {
    if (!Number.isSafeInteger(take) || take < 0 || !Number.isSafeInteger(skip) || skip < 0)
      throw new Error('Invalid library read page');
    const match = this.predicate(where);
    let rows = this.ordered.get(date);
    if (!rows) {
      rows = [...this.rows.values()].sort((a, b) => {
        const diff = new Date(String(b[date])).getTime() - new Date(String(a[date])).getTime();
        return diff || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0);
      });
      this.ordered.set(date, rows);
    }
    const result: string[] = [];
    for (let i = 0; i < rows.length && result.length < take; i++) {
      const row = rows[direction === 'desc' ? i : rows.length - 1 - i]!;
      if (!match(row)) continue;
      if (skip) {
        skip--;
        continue;
      }
      result.push(row.id as string);
    }
    return result;
  }
  count(where: AssetSearchWhere) {
    const match = this.predicate(where);
    let result = 0;
    for (const row of this.rows.values()) if (match(row)) result++;
    return result;
  }
}
