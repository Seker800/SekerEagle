import type { EagleAssetListItem } from './eagle-api';
import { request } from './api-client';
import { libraryApiPath, type LibraryMode } from './library-api-scope';
export interface DuplicateFilters {
  sameVisual?: string;
  sameName?: string;
  sameCapturedAt?: string;
  sameDimensions?: string;
  sameFormat?: string;
  sameBytes?: string;
  protectEdits?: string;
  maxBytes?: string;
  kind?: string;
}
export interface DuplicateGroupSummary {
  signature: string;
  kind: 'EXACT' | 'SIMILAR';
  recommendedId: string;
  count: number;
  removableBytes: number;
  previews: EagleAssetListItem[];
}
export interface DuplicateResults {
  outdatedGroups?: number;
  algorithmVersion?: string;
  originalCheckCompleted?: boolean;
  originalCheckAttempted?: boolean;
  revision: string;
  exactRevision: string;
  exactItems: number;
  filteredItems?: number;
  verifiedItems?: number;
  verifiedGroups?: number;
  coverage: {
    total: number;
    indexed: number;
    waiting: number;
    originalsVerified?: number;
    unsupportedOriginals?: number;
  };
  totalGroups: number;
  exactGroups: number;
  similarGroups: number;
  ignoredGroups: number;
  removableBytes: number;
  nextCursor: string | null;
  groups: DuplicateGroupSummary[];
}
export interface DuplicateMembers {
  signature: string;
  kind: 'EXACT' | 'SIMILAR';
  recommendedId: string;
  total: number;
  nextCursor: string | null;
  items: Array<
    EagleAssetListItem & {
      annotation: { description: string | null; sourceUrl: string | null } | null;
      editedCopy: boolean;
      livePhoto: boolean;
    }
  >;
}
export interface DuplicateCleanupInput {
  operationId: string;
  filters?: DuplicateFilters;
  keepOverrides?: Array<{ signature: string; keepIds?: string[]; removeIds?: string[] }>;
  revision?: string;
  allExact?: boolean;
  allVerified?: boolean;
  signatures?: string[];
  groups?: Array<{ signature: string; keepIds?: string[]; removeIds?: string[] }>;
}
export function createDuplicatesApi(mode: LibraryMode) {
  const base = libraryApiPath('/api/eagle/duplicates', mode);
  return {
    list: (
      query: DuplicateFilters & { cursor?: string; revision?: string; showIgnored?: string },
      signal?: AbortSignal,
    ) =>
      request<DuplicateResults>(
        `${base}?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
        { signal },
      ),
    members: (
      signature: string,
      cursor: string | undefined,
      signal?: AbortSignal,
      filters: DuplicateFilters = {},
    ) =>
      request<DuplicateMembers>(
        `${base}/${encodeURIComponent(signature)}/members?${new URLSearchParams(Object.entries({ ...filters, cursor }).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
        { signal },
      ),
    scan: (operationId: string, onlyIfUnattempted = false) =>
      request<{ operationId: string | null; alreadyAttempted?: boolean }>(`${base}/scan`, {
        method: 'POST',
        body: JSON.stringify({
          operationId,
          ...(onlyIfUnattempted ? { onlyIfUnattempted: true } : {}),
        }),
      }),
    cleanup: (input: DuplicateCleanupInput) =>
      request<{ operationId: string | null; assetIds?: string[] }>(`${base}/cleanup`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ignoreFiltered: (revision: string, filters: DuplicateFilters, ignored: boolean) =>
      request<{ ignored: boolean }>(`${base}/ignore`, {
        method: 'POST',
        body: JSON.stringify({ allFiltered: true, revision, filters, ignored }),
      }),
    ignore: (signature: string, ignored: boolean, filters?: DuplicateFilters) =>
      request<{ ignored: boolean }>(`${base}/ignore`, {
        method: 'POST',
        body: JSON.stringify({ signature, ignored, filters }),
      }),
  };
}
