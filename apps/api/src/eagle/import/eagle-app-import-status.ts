/** Status vocabulary owned by the optional Eagle App import adapter. */
export const EagleImportItemStatus = {
  STAGED: 'STAGED',
  UPLOADING: 'UPLOADING',
  FINALIZING: 'FINALIZING',
  IMPORTED: 'IMPORTED',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type EagleImportItemStatus =
  (typeof EagleImportItemStatus)[keyof typeof EagleImportItemStatus];

export const EagleImportItemAction = {
  NEW: 'NEW',
  UNCHANGED: 'UNCHANGED',
  METADATA_UPDATE: 'METADATA_UPDATE',
  CONTENT_REPLACE: 'CONTENT_REPLACE',
  SKIP_DELETED: 'SKIP_DELETED',
  SKIP_UNSUPPORTED: 'SKIP_UNSUPPORTED',
} as const;

export type EagleImportItemAction =
  (typeof EagleImportItemAction)[keyof typeof EagleImportItemAction];
