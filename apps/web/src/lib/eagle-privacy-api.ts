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

export function getEaglePrivacySettings() {
  return request<EaglePrivacySettings>('/api/eagle/privacy-settings');
}

export function listEaglePrivacyTagOptions() {
  return request<EaglePrivacyTagOption[]>('/api/eagle/tags');
}

export function updateEaglePrivacySettings(tagIds: string[]) {
  return request<EaglePrivacySettings>('/api/eagle/privacy-settings', {
    method: 'PUT',
    body: JSON.stringify({ tagIds }),
  });
}
