import type { UserRole } from '@prisma/client';

export const PAT_SCOPES = ['import:read', 'import:write', 'asset:write', 'capture:write'] as const;
export type PatScope = (typeof PAT_SCOPES)[number];

export interface AuthPrincipal {
  sub: string;
  email: string;
  role: UserRole;
  authVersion: number;
  kind: 'browser' | 'pat';
  scopes: PatScope[];
  canViewPrivate: boolean;
  privacyVisibleUntil: string | null;
}

export interface BrowserSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
  };
}
