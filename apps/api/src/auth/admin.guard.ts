import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): true {
    const principal = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>().user;
    if (!principal || principal.kind !== 'browser' || principal.role !== UserRole.ADMIN) {
      throw new ForbiddenException('需要浏览器管理员会话。');
    }
    return true;
  }
}
