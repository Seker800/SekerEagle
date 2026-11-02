import type { ResidentSemanticGraph } from './eagle-memory-semantic-store';
import {
  compileMemorySearchPredicate,
  type MemoryAsset,
  type MemorySearchContext,
} from './eagle-memory-predicate';
import type { AssetSearchWhere } from './eagle-search-predicate';
import { isDeepStrictEqual } from 'node:util';

export type MemoryDateField = 'libraryAddedAt' | 'chronologicalAt';
export const memoryDateTime = (value: unknown): number =>
  value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : new Date(String(value)).getTime();
/** One library's derived information. Like Eagle, sort once and filter the resident array.
 * No business writes, timers, global user state or independent rule language.
 */
export class LibraryMemoryIndex {
  revision = '0';
  semanticFolders: ReadonlyMap<string, ResidentSemanticGraph> | undefined;
  private rows = new Map<string, MemoryAsset>();
  private ordered = new Map<MemoryDateField, string[]>();
  private derived = new Map<string, { dependencies: readonly string[]; value: unknown }>();
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
        if (!Number.isFinite(memoryDateTime(row[key])))
          throw new Error('Invalid library read date');
      }
    }
  }
  replace(revision: string, rows: MemoryAsset[]) {
    this.validate(revision, rows);
    this.rows = new Map(rows.map((row) => [row.id as string, row]));
    this.revision = revision;
    this.ordered.clear();
    this.derived.clear();
  }
  update(revision: string, ids: string[], rows: MemoryAsset[]) {
    this.validate(revision, rows);
    const incoming = new Set(rows.map((row) => row.id as string));
    for (const [key, entry] of this.derived) {
      if (
        ids.some((id) => !incoming.has(id)) ||
        rows.some((row) => {
          const old = this.rows.get(row.id as string);
          return (
            !old || entry.dependencies.some((field) => !isDeepStrictEqual(old[field], row[field]))
          );
        })
      )
        this.derived.delete(key);
    }
    let reorder = false;
    for (const id of ids) {
      if (!incoming.has(id)) {
        this.rows.delete(id);
        reorder = true;
      }
    }
    for (const row of rows) {
      const previous = this.rows.get(row.id as string);
      if (previous) {
        if (
          memoryDateTime(previous.libraryAddedAt) !== memoryDateTime(row.libraryAddedAt) ||
          memoryDateTime(previous.chronologicalAt) !== memoryDateTime(row.chronologicalAt)
        )
          reorder = true;
        this.rows.set(row.id as string, row);
      } else {
        this.rows.set(row.id as string, row);
        reorder = true;
      }
    }
    this.revision = revision;
    if (reorder) this.ordered.clear();
  }
  get(id: string): MemoryAsset | undefined {
    return this.rows.get(id);
  }
  get size() {
    return this.rows.size;
  }
  /** Copy the reference table; published rows and date-order arrays are never mutated. */
  snapshot(): LibraryMemoryIndex {
    const view = new LibraryMemoryIndex(this.ownerId, this.libraryMode);
    view.revision = this.revision;
    view.semanticFolders = this.semanticFolders;
    view.rows = new Map(this.rows);
    view.ordered = new Map(this.ordered);
    view.derived = new Map(this.derived);
    return view;
  }
  private predicate(where: AssetSearchWhere, context?: MemorySearchContext) {
    return compileMemorySearchPredicate(
      {
        AND: [
          { ownerId: this.ownerId, libraryMode: this.libraryMode as 'PHOTO' | 'MATERIAL' },
          where,
        ],
      },
      context,
    );
  }
  page(
    where: AssetSearchWhere,
    date: MemoryDateField,
    direction: 'asc' | 'desc',
    take: number,
    skip: number,
    context?: MemorySearchContext,
  ): string[] {
    if (!Number.isSafeInteger(take) || take < 0 || !Number.isSafeInteger(skip) || skip < 0)
      throw new Error('Invalid library read page');
    const match = this.predicate(where, context);
    let rows = this.ordered.get(date);
    if (!rows) {
      rows = [...this.rows.values()]
        .sort((a, b) => {
          const diff = memoryDateTime(b[date]) - memoryDateTime(a[date]);
          return diff || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0);
        })
        .map((row) => row.id as string);
      this.ordered.set(date, rows);
    }
    const result: string[] = [];
    for (let i = 0; i < rows.length && result.length < take; i++) {
      const row = this.rows.get(rows[direction === 'desc' ? i : rows.length - 1 - i]!)!;
      if (!match(row)) continue;
      if (skip) {
        skip--;
        continue;
      }
      result.push(row.id as string);
    }
    return result;
  }
  count(where: AssetSearchWhere, context?: MemorySearchContext) {
    const match = this.predicate(where, context);
    let result = 0;
    for (const row of this.rows.values()) if (match(row)) result++;
    return result;
  }
  forEach(
    where: AssetSearchWhere,
    visit: (row: MemoryAsset) => void,
    context?: MemorySearchContext,
  ) {
    const match = this.predicate(where, context);
    for (const row of this.rows.values()) if (match(row)) visit(row);
  }
  /** Callers own a finite set of projection keys; user query strings are not cache keys. */
  derive<T>(key: string, dependencies: readonly string[], build: () => T): T {
    const cached = this.derived.get(key);
    if (cached) return cached.value as T;
    const value = build();
    this.derived.set(key, { dependencies, value });
    return value;
  }
}
