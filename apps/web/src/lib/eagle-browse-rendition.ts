import type { EagleAssetListItem, EagleRendition } from './eagle-api';

import { selectBrowseRendition } from '@sekereagle/library-core';

/** Current browsing media only; editing and motion derivatives have separate consumers. */
export function selectEagleBrowseRendition(asset: EagleAssetListItem): EagleRendition | undefined {
  return selectBrowseRendition(asset);
}
