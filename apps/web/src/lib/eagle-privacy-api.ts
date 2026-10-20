import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { request } from './api-client';

export interface EaglePrivacySettings {
  tagIds: string[];
}

export interface EaglePrivacyTagOption {
  id: string;
  name: string;
  color: string | null;
  pinyin: string;
  pinyinInitials: string;
}
export function createEaglePrivacyApi(libraryMode: LibraryMode = 'MATERIAL') {
  function getEaglePrivacySettings() {
    return request<EaglePrivacySettings>(
      libraryApiPath('/api/eagle/privacy-settings', libraryMode),
    );
  }

  function listEaglePrivacyTagOptions() {
    return request<EaglePrivacyTagOption[]>(libraryApiPath('/api/eagle/tags', libraryMode));
  }

  function updateEaglePrivacySettings(tagIds: string[], expectedTagIds: string[]) {
    return request<EaglePrivacySettings>(
      libraryApiPath('/api/eagle/privacy-settings', libraryMode),
      {
        method: 'PUT',
        body: JSON.stringify({ tagIds, expectedTagIds }),
      },
    );
  }
  return { getEaglePrivacySettings, listEaglePrivacyTagOptions, updateEaglePrivacySettings };
}
export const { getEaglePrivacySettings, listEaglePrivacyTagOptions, updateEaglePrivacySettings } =
  createEaglePrivacyApi();
