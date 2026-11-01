/** Recovery clock only. LISTEN notifications and per-lane draining stay immediate. */
export function operationIdlePollDelay(baseMs: number, idlePasses: number) {
  return Math.max(baseMs, Math.min(30_000, baseMs * 2 ** Math.min(idlePasses, 20)));
}
