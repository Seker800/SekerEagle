export const DUPLICATE_GROUPING_VERSION = 'original-pixels-v3';
export const DUPLICATE_PIXEL_VERSION = 'oriented-srgb-rgba8-v1';
export function canonicalDuplicateFormat(format: string) {
  const v = format.trim().toLowerCase();
  return (
    ({ jpg: 'jpeg', jpe: 'jpeg', tif: 'tiff', heif: 'heic' } as Record<string, string>)[v] ?? v
  );
}
/** Pixel evidence is deliberately independent of semantic search and photo burst grouping. */
export interface DuplicateFingerprint {
  hash: string;
  colors: number[];
  contrast: number;
}
export interface DuplicateCandidate {
  id: string;
  format: string;
  isEdited?: boolean;
  isLivePhoto?: boolean;
  pixelHash?: string | null;
  sha256: string | null;
  mediaRevision: number;
  rowVersion: number;
  isPrivate: boolean;
  byteSize: number;
  width: number | null;
  height: number | null;
  rating: number | null;
  libraryAddedAt: string;
  fingerprint: DuplicateFingerprint | null;
}
/** Only full-resolution, current-version proofs qualify. Preview similarity is discovery only. */
export function findVerifiedPixelGroups(input: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const buckets = new Map<string, DuplicateCandidate[]>();
  const fileKey = (row: DuplicateCandidate) =>
    JSON.stringify([row.isPrivate, canonicalDuplicateFormat(row.format), row.sha256, row.byteSize]);
  const proofs = new Map(
    input
      .filter((row) => row.sha256 && row.pixelHash && /^[a-f0-9]{64}$/.test(row.pixelHash))
      .map((row) => [fileKey(row), row.pixelHash!]),
  );
  for (const row of input) {
    const pixelHash = row.pixelHash ?? (row.sha256 ? proofs.get(fileKey(row)) : null);
    if (!pixelHash || !/^[a-f0-9]{64}$/.test(pixelHash) || row.isEdited || row.isLivePhoto)
      continue;
    const format = canonicalDuplicateFormat(row.format);
    if (format !== 'jpeg' && format !== 'png') continue;
    const key = `${row.isPrivate}:${format}:${pixelHash}`;
    const members = buckets.get(key) ?? [];
    members.push(row);
    buckets.set(key, members);
  }
  return [...buckets.values()]
    .filter(
      (members) =>
        members.length > 1 &&
        new Set(members.map((row) => (row.sha256 ? `${row.sha256}:${row.byteSize}` : row.id)))
          .size > 1,
    )
    .map((members) => {
      members.sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          b.byteSize - a.byteSize ||
          a.libraryAddedAt.localeCompare(b.libraryAddedAt) ||
          a.id.localeCompare(b.id),
      );
      return {
        kind: 'SIMILAR' as const,
        assetIds: members.map((row) => row.id),
        recommendedId: members[0]!.id,
        removableBytes: members.slice(1).reduce((n, row) => n + row.byteSize, 0),
      };
    })
    .sort(
      (a, b) =>
        b.removableBytes - a.removableBytes || a.recommendedId.localeCompare(b.recommendedId),
    );
}
export interface DuplicateGroup {
  kind: 'EXACT' | 'SIMILAR';
  assetIds: string[];
  recommendedId: string;
  removableBytes: number;
}
function popcount(n: number) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function hashParts(hash: string) {
  return [parseInt(hash.slice(0, 8), 16), parseInt(hash.slice(8), 16)] as const;
}
export function duplicateHashDistance(a: string, b: string) {
  const left = hashParts(a),
    right = hashParts(b);
  return popcount(left[0] ^ right[0]) + popcount(left[1] ^ right[1]);
}
function validFingerprint(value: DuplicateFingerprint | null): value is DuplicateFingerprint {
  return (
    !!value &&
    /^[a-f0-9]{16}$/.test(value.hash) &&
    value.contrast >= 8 &&
    value.colors.length === 48 &&
    value.colors.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)
  );
}
function visuallyMatches(a: DuplicateCandidate, b: DuplicateCandidate) {
  if (
    !a.width ||
    !a.height ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.isEdited ||
    b.isEdited ||
    canonicalDuplicateFormat(a.format) !== canonicalDuplicateFormat(b.format)
  )
    return false;
  const left = a.fingerprint!,
    right = b.fingerprint!;
  const rms = Math.sqrt(
    left.colors.reduce((sum, n, i) => sum + (n - right.colors[i]!) ** 2, 0) / 48,
  );
  return rms <= 18;
}
/** Stable reference-star groups: A≈B and B≈C never implies A≈C. */
export function findDuplicateGroups(input: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const rows = [...input].sort(
    (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
      b.byteSize - a.byteSize ||
      a.libraryAddedAt.localeCompare(b.libraryAddedAt) ||
      a.id.localeCompare(b.id),
  );
  const exact = new Map<string, DuplicateCandidate[]>(),
    used = new Set<string>(),
    groups: DuplicateGroup[] = [];
  const add = (kind: DuplicateGroup['kind'], members: DuplicateCandidate[]) => {
    for (const row of members) used.add(row.id);
    groups.push({
      kind,
      assetIds: members.map((r) => r.id),
      recommendedId: members[0]!.id,
      removableBytes: members.slice(1).reduce((n, row) => n + row.byteSize, 0),
    });
  };
  for (const row of rows) {
    if (!row.sha256) continue;
    const key = `${row.isPrivate}:${canonicalDuplicateFormat(row.format)}:${row.sha256}:${row.byteSize}`;
    const members = exact.get(key) ?? [];
    members.push(row);
    exact.set(key, members);
  }
  for (const members of exact.values()) if (members.length > 1) add('EXACT', members);
  const hiddenExact = new Set(groups.flatMap((group) => group.assetIds.slice(1)));
  used.clear();
  for (const privateScope of [false, true]) {
    const eligible = rows.filter(
      (row) =>
        !hiddenExact.has(row.id) &&
        row.isPrivate === privateScope &&
        validFingerprint(row.fingerprint),
    );
    // Six disjoint hash bands guarantee a shared band for every distance <= 5.
    // This avoids an all-pairs scan and keeps the candidate window complete.
    const ranges = [
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 12],
      [12, 14],
      [14, 16],
    ] as const;
    const bands = ranges.map(() => new Map<string, number[]>());
    const high = new Uint32Array(eligible.length),
      low = new Uint32Array(eligible.length);
    eligible.forEach((row, index) => {
      const hash = row.fingerprint!.hash,
        parts = hashParts(hash);
      high[index] = parts[0];
      low[index] = parts[1];
      ranges.forEach(([start, end], band) => {
        const key = `${canonicalDuplicateFormat(row.format)}:${row.width}:${row.height}:${hash.slice(start, end)}`,
          bucket = bands[band]!.get(key) ?? [];
        bucket.push(index);
        bands[band]!.set(key, bucket);
      });
    });
    const visited = new Uint32Array(eligible.length),
      assigned = new Uint8Array(eligible.length);
    for (let index = 0; index < eligible.length; index++) {
      if (assigned[index]) continue;
      const reference = eligible[index]!,
        matches: number[] = [];
      ranges.forEach(([start, end], band) => {
        for (const candidate of bands[band]!.get(
          `${canonicalDuplicateFormat(reference.format)}:${reference.width}:${reference.height}:${reference.fingerprint!.hash.slice(start, end)}`,
        ) ?? []) {
          if (candidate === index || assigned[candidate] || visited[candidate] === index + 1)
            continue;
          visited[candidate] = index + 1;
          if (
            popcount(high[index]! ^ high[candidate]!) + popcount(low[index]! ^ low[candidate]!) <=
              5 &&
            visuallyMatches(reference, eligible[candidate]!)
          )
            matches.push(candidate);
        }
      });
      if (matches.length) {
        matches.sort((a, b) => a - b);
        assigned[index] = 1;
        for (const candidate of matches) assigned[candidate] = 1;
        add('SIMILAR', [reference, ...matches.map((i) => eligible[i]!)]);
      }
    }
  }
  return groups.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'EXACT' ? -1 : 1) ||
      b.removableBytes - a.removableBytes ||
      a.recommendedId.localeCompare(b.recommendedId),
  );
}
