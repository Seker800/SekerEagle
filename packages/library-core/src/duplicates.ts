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
export function duplicateHashDistance(a: string, b: string) {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  return count;
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
interface HashNode { hash: string; rows: DuplicateCandidate[]; children: Map<number, HashNode> }
function insert(root: HashNode, row: DuplicateCandidate) {
  let node = root;
  for (;;) {
    const distance = duplicateHashDistance(node.hash, row.fingerprint!.hash);
    if (!distance) { node.rows.push(row); return; }
    const child = node.children.get(distance);
    if (child) node = child;
    else { node.children.set(distance, { hash: row.fingerprint!.hash, rows: [row], children: new Map() }); return; }
  }
}
function nearby(root: HashNode, row: DuplicateCandidate) {
  const result: DuplicateCandidate[] = [], stack = [root];
  while (stack.length) {
    const node = stack.pop()!, distance = duplicateHashDistance(node.hash, row.fingerprint!.hash);
    if (distance <= 5) result.push(...node.rows);
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
  for (const privateScope of [false, true]) {
    const eligible = rows.filter(row => !used.has(row.id) && row.isPrivate === privateScope && validFingerprint(row.fingerprint));
    const first = eligible[0];
    if (!first) continue;
    const root: HashNode = { hash: first.fingerprint!.hash, rows: [first], children: new Map() };
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
