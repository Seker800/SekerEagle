/** Photo browsing emits only the existing 1600/512/256 WebPs and bounded metadata.
 * It defers RAW edit output and motion to details, so it cannot return a large clip.
 * Enforce the same envelope at the producer and receiver before reducing admission cost.
 */
export const IMAGE_WORK_MAX_RESPONSE_BYTES = 256 * 1024 ** 2;
interface Work {
  kind: string;
  mode: 'PHOTO' | 'MATERIAL';
  detailsOnly: boolean;
}
export function imageWorkResponseLimit(work: Work): number {
  if (work.kind === 'EXTRACT_COLOR_PALETTE') return 2 * 1024 ** 2;
  return work.mode === 'PHOTO' && !work.detailsOnly
    ? 32 * 1024 ** 2
    : IMAGE_WORK_MAX_RESPONSE_BYTES;
}
export function imageWorkMemoryMiB(work: Work): number {
  if (work.kind === 'EXTRACT_COLOR_PALETTE') return 64;
  // Covers receive chunks + concatenation, retained outputs/publication and overhead.
  return imageWorkResponseLimit(work) <= 32 * 1024 ** 2 ? 128 : 768;
}
