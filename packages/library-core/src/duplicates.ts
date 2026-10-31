/** Pixel evidence is deliberately independent of semantic search and photo burst grouping. */
export interface DuplicateFingerprint { hash: string; colors: number[]; contrast: number }
export interface DuplicateCandidate {
  id: string; sha256: string | null; mediaRevision: number; rowVersion: number;
  isPrivate: boolean; byteSize: number; width: number | null; height: number | null;
  rating: number | null; libraryAddedAt: string; fingerprint: DuplicateFingerprint | null;
}
export interface DuplicateGroup {
  kind: 'EXACT' | 'SIMILAR'; assetIds: string[]; recommendedId: string; removableBytes: number;
}
function popcount(n: number) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function hashParts(hash: string) { return [parseInt(hash.slice(0,8),16), parseInt(hash.slice(8),16)] as const; }
export function duplicateHashDistance(a: string, b: string) {
  const left = hashParts(a), right = hashParts(b);
  return popcount(left[0] ^ right[0]) + popcount(left[1] ^ right[1]);
}
function validFingerprint(value: DuplicateFingerprint | null): value is DuplicateFingerprint {
  return !!value && /^[a-f0-9]{16}$/.test(value.hash) && value.contrast >= 8 &&
    value.colors.length === 48 && value.colors.every(n => Number.isFinite(n) && n >= 0 && n <= 255);
}
function visuallyMatches(a: DuplicateCandidate, b: DuplicateCandidate) {
  if (!a.width || !a.height || !b.width || !b.height) return false;
  if (Math.abs((a.width / a.height) / (b.width / b.height) - 1) > 0.02) return false;
  const left = a.fingerprint!, right = b.fingerprint!;
  const rms = Math.sqrt(left.colors.reduce((sum, n, i) => sum + (n - right.colors[i]!) ** 2, 0) / 48);
  return rms <= 18;
}
interface HashNode { parts: readonly [number,number]; hash: string; rows: DuplicateCandidate[]; children: Map<number, HashNode> }
function insert(root: HashNode, row: DuplicateCandidate) {
  let node = root; const parts = hashParts(row.fingerprint!.hash);
  for (;;) {
    const distance = popcount(node.parts[0] ^ parts[0]) + popcount(node.parts[1] ^ parts[1]);
    if (!distance) { node.rows.push(row); return; }
    const child = node.children.get(distance);
    if (child) node = child;
    else { node.children.set(distance, { parts, hash: row.fingerprint!.hash, rows: [row], children: new Map() }); return; }
  }
}
function nearby(root: HashNode, row: DuplicateCandidate) {
  const result: DuplicateCandidate[] = [], stack = [root], parts = hashParts(row.fingerprint!.hash);
  while (stack.length) {
    const node = stack.pop()!, distance = popcount(node.parts[0] ^ parts[0]) + popcount(node.parts[1] ^ parts[1]);
    if (distance <= 5) for (const candidate of node.rows) result.push(candidate);
    for (const [edge, child] of node.children) if (Math.abs(edge - distance) <= 5) stack.push(child);
  }
  return result;
}
/** Stable reference-star groups: A≈B and B≈C never implies A≈C. */
export function findDuplicateGroups(input: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const rows = [...input].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) ||
    (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
    b.byteSize - a.byteSize || a.libraryAddedAt.localeCompare(b.libraryAddedAt) || a.id.localeCompare(b.id));
  const exact = new Map<string, DuplicateCandidate[]>(), used = new Set<string>(), groups: DuplicateGroup[] = [];
  const add = (kind: DuplicateGroup['kind'], members: DuplicateCandidate[]) => {
    for (const row of members) used.add(row.id);
    groups.push({ kind, assetIds: members.map(r => r.id), recommendedId: members[0]!.id,
      removableBytes: members.slice(1).reduce((n, row) => n + row.byteSize, 0) });
  };
  for (const row of rows) {
    if (!row.sha256) continue;
    const key = `${row.isPrivate}:${row.sha256}:${row.byteSize}`;
    const members = exact.get(key) ?? []; members.push(row); exact.set(key, members);
  }
  for (const members of exact.values()) if (members.length > 1) add('EXACT', members);
  const hiddenExact = new Set(groups.flatMap(group => group.assetIds.slice(1)));
  used.clear();
  for (const privateScope of [false, true]) {
    const eligible = rows.filter(row => !hiddenExact.has(row.id) && row.isPrivate === privateScope && validFingerprint(row.fingerprint));
    const first = eligible[0];
    if (!first) continue;
    const root: HashNode = { parts: hashParts(first.fingerprint!.hash), hash: first.fingerprint!.hash, rows: [first], children: new Map() };
    for (const row of eligible.slice(1)) insert(root, row);
    const rank = new Map(eligible.map((row, index) => [row.id, index]));
    for (const reference of eligible) {
      if (used.has(reference.id)) continue;
      const matches = nearby(root, reference).filter(row => row.id !== reference.id && !used.has(row.id) && visuallyMatches(reference, row));
      matches.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      if (matches.length) add('SIMILAR', [reference, ...matches]);
    }
  }
  return groups.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'EXACT' ? -1 : 1) || b.removableBytes - a.removableBytes || a.recommendedId.localeCompare(b.recommendedId));
}
