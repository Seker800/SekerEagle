import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types';

@Injectable()
export class BrowserPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): true {
    const principal = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>().user;
    if (!principal || principal.kind !== 'browser') {
      throw new ForbiddenException('此操作只允许浏览器登录会话。');
    }
    return true;
  }
}
