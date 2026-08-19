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

export function getPrivacyVisibility() {
  return request<PrivacyVisibilityState>('/api/auth/privacy-visibility');
}

export function updatePrivacyVisibility(enabled: boolean, durationHours: number) {
  return request<PrivacyVisibilityState>('/api/auth/privacy-visibility', {
    method: 'PUT',
    body: JSON.stringify({ enabled, durationHours }),
  });
}
