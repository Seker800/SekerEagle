import type { EagleAssetOperation, EagleAssetOperationItem } from '@prisma/client';

export type Snapshot = { id: string; rowVersion: number; mediaRevision: number };

export type OperationWithItems = Pick<
  EagleAssetOperation,
  | 'id'
  | 'ownerId'
  | 'kind'
  | 'libraryMode'
  | 'privacyChanged'
  | 'queuedWeight'
  | 'runningWeight'
  | 'completedWeight'
  | 'skippedWeight'
  | 'failedWeight'
  | 'cancelledWeight'
  | 'errorCounts'
> & {
  undoOfId?: string | null;
  inputIds?: string[];
  items?: Array<Pick<EagleAssetOperationItem, 'status' | 'weight' | 'errorCode'>>;
};

export type ClaimedItem = EagleAssetOperationItem & { operation: EagleAssetOperation };
