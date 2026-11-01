/** Invalidation hints; canonical data is always read through its original capability. */
export const WORKSPACE_CHANGE_CHANNEL = 'sekereagle_workspace_changes';
export const WORKSPACE_CHANGE_KINDS = [
  'ASSETS',
  'LABELS',
  'PEOPLE',
  'MAP',
  'FOLDERS',
  'RECOMMENDATIONS',
  'OPERATIONS',
  'TASKS',
  'SETTINGS',
  'AGENT',
] as const;
export type WorkspaceChangeKind = (typeof WORKSPACE_CHANGE_KINDS)[number];
export type WorkspaceChangeEvent = {
  ownerId: string;
  libraryMode: 'MATERIAL' | 'PHOTO';
  kinds: readonly WorkspaceChangeKind[];
  public: boolean;
};
export interface WorkspaceChanges {
  epoch: string;
  scopes: Record<'MATERIAL' | 'PHOTO', Record<WorkspaceChangeKind, string>>;
}
export function parseWorkspaceChange(value: string): WorkspaceChangeEvent | null {
  try {
    const event = JSON.parse(value) as WorkspaceChangeEvent;
    return typeof event.ownerId === 'string' &&
      !!event.ownerId &&
      (event.libraryMode === 'MATERIAL' || event.libraryMode === 'PHOTO') &&
      typeof event.public === 'boolean' &&
      Array.isArray(event.kinds) &&
      event.kinds.length > 0 &&
      event.kinds.every((kind) => WORKSPACE_CHANGE_KINDS.includes(kind))
      ? event
      : null;
  } catch {
    return null;
  }
}
