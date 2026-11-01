import { paletteColorScore, COLOR_PALETTE_VERSION } from '@sekereagle/library-core';
import { searchPredicateModels, type AssetSearchWhere } from './eagle-search-predicate';

export type MemoryAsset = Record<string, unknown>;
export interface MemorySearchContext {
  owner: MemoryAsset;
  embeddings: ReadonlyMap<string, MemoryAsset[]>;
}
type Truth = boolean | null;
type Check = (row: MemoryAsset) => Truth;
const unsupported = () => new Error('Unsupported memory search predicate');
const object = (value: unknown): MemoryAsset => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsupported();
  return value as MemoryAsset;
};
const not = (value: Truth): Truth => (value === null ? null : !value);
function combine(checks: Check[], any = false): Check {
  return (row) => {
    let unknown = false;
    for (const check of checks) {
      const value = check(row);
      if (value === any) return any;
      if (value === null) unknown = true;
    }
    return unknown ? null : !any;
  };
}

// LIKE is the existing PostgreSQL adapter's contract, including escaped wildcards.
function like(pattern: string, insensitive: boolean): RegExp {
  if (insensitive && uncertainCase(pattern)) throw unsupported();
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    let char = pattern[i]!;
    if (char === '\\') {
      if (++i === pattern.length) throw unsupported();
      char = pattern[i]!;
    } else if (char === '%') {
      source += '[\\s\\S]*';
      continue;
    } else if (char === '_') {
      source += '[\\s\\S]';
      continue;
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source + '$', insensitive ? 'iu' : 'u');
}
function uncertainCase(value: string) {
  const nonAscii = value.replace(/\p{ASCII}/gu, '');
  return nonAscii.toLowerCase() !== nonAscii.toUpperCase();
}
function comparable(value: unknown, field: string): string | number | bigint | boolean {
  if (field === 'byteSize') return BigInt(String(value));
  if (value instanceof Date) return value.getTime();
  if (field.endsWith('At') && typeof value === 'string') return new Date(value).getTime();
  if (['string', 'number', 'bigint', 'boolean'].includes(typeof value))
    return value as string | number | bigint | boolean;
  throw unsupported();
}
function scalar(field: string, value: unknown, inheritedInsensitive = false): Check {
  if (value === null) return (row) => row[field] == null;
  if (typeof value === 'string' && inheritedInsensitive)
    return scalar(field, { equals: value, mode: 'insensitive' });
  if (value instanceof Date || typeof value !== 'object') {
    const expected = comparable(value, field);
    return (row) => (row[field] == null ? null : comparable(row[field], field) === expected);
  }
  const checks: Check[] = [];
  const input = object(value);
  if (input.mode !== undefined && input.mode !== 'insensitive' && input.mode !== 'default')
    throw unsupported();
  const insensitive = inheritedInsensitive || input.mode === 'insensitive';
  for (const [op, operand] of Object.entries(input)) {
    if (operand === undefined || op === 'mode') continue;
    if (op === 'not') {
      if (operand === null) checks.push((row) => row[field] != null);
      else {
        const check = scalar(field, operand, insensitive);
        checks.push((row) => not(check(row)));
      }
    } else if (op === 'equals' && operand === null) checks.push((row) => row[field] == null);
    else if (
      ['contains', 'startsWith', 'endsWith'].includes(op) ||
      (op === 'equals' && insensitive)
    ) {
      if (typeof operand !== 'string') throw unsupported();
      const pattern =
        op === 'equals'
          ? operand
          : `${op === 'startsWith' ? '' : '%'}${operand}${op === 'endsWith' ? '' : '%'}`;
      const regex = like(pattern, insensitive);
      checks.push((row) => {
        const actual = row[field];
        if (actual == null) return null;
        if (typeof actual !== 'string') throw unsupported();
        if (insensitive && uncertainCase(actual)) throw unsupported();
        return regex.test(actual);
      });
    } else if (op === 'in' || op === 'notIn') {
      if (!Array.isArray(operand)) throw unsupported();
      const set = new Set(operand.map((v) => comparable(v, field)));
      checks.push((row) =>
        !set.size
          ? op === 'notIn'
          : row[field] == null
            ? null
            : set.has(comparable(row[field], field)) === (op === 'in'),
      );
    } else if (['equals', 'lt', 'lte', 'gt', 'gte'].includes(op)) {
      const expected = comparable(operand, field);
      checks.push((row) => {
        if (row[field] == null) return null;
        const actual = comparable(row[field], field);
        switch (op) {
          case 'lt':
            return actual < expected;
          case 'lte':
            return actual <= expected;
          case 'gt':
            return actual > expected;
          case 'gte':
            return actual >= expected;
          default:
            return actual === expected;
        }
      });
    } else throw unsupported();
  }
  return combine(checks);
}

/** Eagle-style in-memory iteration of the existing canonical predicate, not a second rule compiler.
 * SQL UNKNOWN is retained so negative filters do not accidentally include NULL values.
 * Unknown capabilities throw before any rows are scanned; callers retain the SQL path.
 */
export function compileMemorySearchPredicate(
  where: AssetSearchWhere,
  context?: MemorySearchContext,
): (row: MemoryAsset) => boolean {
  const visit = (name: string, input: unknown, preserveNull = false): Check => {
    if (!context && ['embedding', 'owner', 'snapshot', 'match', 'folder'].includes(name)) throw unsupported();
    const definition = searchPredicateModels[name];
    if (!definition) throw unsupported();
    const checks: Check[] = [];
    for (const [key, value] of Object.entries(object(input))) {
      if (value === undefined) continue;
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const entries = (Array.isArray(value) ? value : [value]).map((part) =>
          visit(name, part, preserveNull || key === 'NOT'),
        );
        checks.push(
          key === 'NOT'
            ? combine(entries.map((check) => (row) => not(check(row))))
            : combine(entries, key === 'OR'),
        );
      } else if (key === 'colorMatch' && name === 'asset') {
        if (typeof value !== 'string') throw unsupported();
        checks.push((row) => {
          const analyses = (row.colorAnalyses ?? []) as MemoryAsset[];
          return analyses.some(
            (analysis) =>
              analysis.isCurrent &&
              analysis.status === 'COMPLETED' &&
              analysis.processorVersion === COLOR_PALETTE_VERSION &&
              analysis.assetRevision === row.mediaRevision &&
              paletteColorScore(
                value,
                analysis.swatches as Parameters<typeof paletteColorScore>[1],
              ) !== null,
          );
        });
      } else if (definition.fields.has(key)) {
        const check = scalar(key, value);
        checks.push((row) => {
          if (row[key] === undefined) throw unsupported();
          return check(row);
        });
      } else {
        const link = definition.relations[key];
        if (!link) throw unsupported();
        const rows = (row: MemoryAsset): MemoryAsset[] => {
          const data = name === 'asset' && context && key === 'owner' ? context.owner
            : name === 'asset' && context && key === 'embeddings' ? context.embeddings.get(String(row.id))
            : row[key];
          return data == null ? [] : Array.isArray(data) ? (data as MemoryAsset[]) : [object(data)];
        };
        if (value === null) {
          checks.push((row) => !rows(row).length);
          continue;
        }
        const filter = object(value);
        const operators = Object.keys(filter).filter((op) =>
          ['some', 'none', 'every', 'is', 'isNot'].includes(op),
        );
        if (operators.length && operators.length !== Object.keys(filter).length)
          throw unsupported();
        const match = (operand: unknown, negative: boolean): Check => {
          const check = visit(link.model, operand, negative);
          return (row) => {
            const related = rows(row);
            if (!related.length) return false;
            if (link.many || !negative) return related.some((child) => check(child) === true);
            // Matches the SQL adapter's count/bool_and treatment of a missing to-one.
            return combine(related.map((child) => () => check(child)))(row);
          };
        };
        if (!operators.length) checks.push(match(filter, preserveNull));
        else
          for (const op of operators) {
            const operand = filter[op];
            if (operand === undefined) continue;
            if (operand === null)
              checks.push((row) => Boolean(rows(row).length) === (op === 'none' || op === 'isNot'));
            else if (op === 'some' || op === 'is') checks.push(match(operand, preserveNull));
            else if (op === 'every') {
              const check = visit(link.model, operand, true);
              checks.push((row) => !rows(row).some((child) => check(child) === false));
            } else {
              const check = match(operand, true);
              checks.push((row) => not(check(row)));
            }
          }
      }
    }
    return combine(checks);
  };
  const check = visit('asset', where);
  return (row) => check(row) === true;
}
