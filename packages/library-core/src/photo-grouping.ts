interface GroupCandidate {
  id: string;
  capturedAt: Date | null;
  cameraModel: string | null;
  perceptualHash: string | null;
  sharpnessScore: number | null;
}
function hashDistance(a: string, b: string) {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 65;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`),
    count = 0;
  while (bits) {
    bits &= bits - 1n;
    count++;
  }
  return count;
}
/** Bounded conservative suggestions. Missing capture dates never imply a burst. */
export function suggestPhotoGroups(candidates: readonly GroupCandidate[]) {
  const sorted = candidates
    .filter((row) => row.capturedAt && row.perceptualHash)
    .toSorted(
      (a, b) => a.capturedAt!.getTime() - b.capturedAt!.getTime() || a.id.localeCompare(b.id),
    );
  const groups: Array<{
    kind: 'BURST' | 'SIMILAR';
    assetIds: string[];
    bestAssetId: string | null;
  }> = [];
  const used = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const anchor = sorted[i]!;
    if (used.has(anchor.id)) continue;
    const members = [anchor];
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j]!;
      const elapsed = next.capturedAt!.getTime() - anchor.capturedAt!.getTime();
      if (elapsed > 10 * 60 * 1000) break;
      if (
        !used.has(next.id) &&
        next.cameraModel === anchor.cameraModel &&
        hashDistance(anchor.perceptualHash!, next.perceptualHash!) <= 8
      )
        members.push(next);
    }
    if (members.length < 2) continue;
    members.forEach((row) => used.add(row.id));
    const ranked = members
      .filter((row) => row.sharpnessScore !== null)
      .toSorted((a, b) => b.sharpnessScore! - a.sharpnessScore! || a.id.localeCompare(b.id));
    groups.push({
      kind:
        members.at(-1)!.capturedAt!.getTime() - anchor.capturedAt!.getTime() <= 3000
          ? 'BURST'
          : 'SIMILAR',
      assetIds: members.map((row) => row.id),
      bestAssetId: ranked[0]?.id ?? null,
    });
  }
  return groups;
}
