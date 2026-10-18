import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { request } from './api-client';

export interface PrivacyVisibilityState {
  enabled: boolean;
  durationHours: number;
  expiresAt: string | null;
}

export const DEFAULT_PRIVACY_VISIBILITY: PrivacyVisibilityState = {
  enabled: false,
  durationHours: 3,
  expiresAt: null,
};
export function createPrivacyVisibilityApi(libraryMode: LibraryMode = 'MATERIAL') {
  function getPrivacyVisibility() {
    return request<PrivacyVisibilityState>(
      libraryApiPath('/api/auth/privacy-visibility', libraryMode),
    );
  }

  function updatePrivacyVisibility(enabled: boolean, durationHours: number) {
    return request<PrivacyVisibilityState>(
      libraryApiPath('/api/auth/privacy-visibility', libraryMode),
      {
        method: 'PUT',
        body: JSON.stringify({ enabled, durationHours }),
      },
    );
  }
  return { getPrivacyVisibility, updatePrivacyVisibility };
}
export const { getPrivacyVisibility, updatePrivacyVisibility } = createPrivacyVisibilityApi();
