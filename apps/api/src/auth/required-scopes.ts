import { SetMetadata } from '@nestjs/common';
import type { PatScope } from './auth.types';

export const REQUIRED_PAT_SCOPES = 'sekereagle:required-pat-scopes';
export const RequirePatScopes = (...scopes: PatScope[]) => SetMetadata(REQUIRED_PAT_SCOPES, scopes);
