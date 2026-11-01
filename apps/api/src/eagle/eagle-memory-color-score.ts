import { paletteColorScore, COLOR_PALETTE_VERSION, type SearchColorSwatch } from '@sekereagle/library-core';
import type { MemoryAsset } from './eagle-memory-predicate';

/** Reuse exact palette results within one query; budget exhaustion only disables memoization. */
export function createMemoryColorScorer(maxBytes = Number(process.env.EAGLE_READER_COLOR_CACHE_BYTES ?? 8388608)) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid color query cache budget');
  const scores = new Map<string, number | null>();
  let bytes = 0;
  return (row: MemoryAsset, color: string): number | null => {
    const analysis = (row.colorAnalyses as MemoryAsset[] | undefined)?.find(item =>
      item.isCurrent && item.status === 'COMPLETED' && item.processorVersion === COLOR_PALETTE_VERSION && item.assetRevision === row.mediaRevision);
    if (!analysis) return null;
    const swatches = analysis.swatches as SearchColorSwatch[];
    const first = swatches[0], second = swatches[1];
    const key = `${color.toLowerCase()}:${first?.hex}:${first?.weight}:${second?.hex}:${second?.weight}`;
    if (scores.has(key)) return scores.get(key)!;
    const score = paletteColorScore(color, swatches);
    const size = key.length * 2 + 96;
    if (bytes + size <= maxBytes) { scores.set(key, score); bytes += size; }
    return score;
  };
}
