import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ACCESS_COOKIE_NAME, PAT_PREFIX } from './auth.constants';
import type { AuthPrincipal } from './auth.types';
import { PatService } from './pat.service';
import { PrivacyVisibilityService } from './privacy-visibility.service';
import { SessionTokenService } from './session-token.service';

type AuthenticatedRequest = Request & { user?: AuthPrincipal };

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionTokenService,
    private readonly pats: PatService,
    private readonly privacyVisibility: PrivacyVisibilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization?.trim() ?? '';
    const bearer = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    if (bearer) {
      if (!bearer.startsWith(PAT_PREFIX))
        throw new UnauthorizedException('仅接受 SekerEagle PAT。');
      request.user = await this.pats.authenticate(bearer);
      return true;
    }
    const token = request.cookies?.[ACCESS_COOKIE_NAME] as string | undefined;
    if (!token) throw new UnauthorizedException('缺少登录状态。');
    request.user = await this.sessions.verifyAccessToken(token);
    const visibleUntil = await this.privacyVisibility.readGrant(request.user.sub, request);
    request.user.canViewPrivate = visibleUntil !== null;
    request.user.privacyVisibleUntil = visibleUntil?.toISOString() ?? null;
    return true;
  }
}
