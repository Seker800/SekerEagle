/** Runtime query-key shape helpers shared by transport/refresh code and the key factory. */
export function isEagleQuery(key: readonly unknown[], ownerId: string, mode: string) {
  return key[0] === 'eagle' && key[1] === ownerId && key[2] === mode;
}

export function isEagleTaskCenterKey(key: readonly unknown[], ownerId: string, mode: string) {
  return key[0] === 'task-center' && key[1] === ownerId && key[2] === mode;
}

export function eagleQuerySection(key: readonly unknown[]): string | null {
  return key[0] === 'eagle' && typeof key[3] === 'string' ? key[3] : null;
}

export function isEagleAssetListShape(key: readonly unknown[]): boolean {
  const filters = key[5];
  return (
    key[0] === 'eagle' &&
    key[3] === 'assets' &&
    key.length === 6 &&
    Boolean(filters && typeof filters === 'object' && !Array.isArray(filters))
  );
}

export function eagleAssetListFilters(key: readonly unknown[]): Record<string, unknown> | null {
  if (!isEagleAssetListShape(key)) return null;
  const filters = key[5];
  return filters && typeof filters === 'object' && !Array.isArray(filters)
    ? (filters as Record<string, unknown>)
    : null;
}
