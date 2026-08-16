import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_PAT_SCOPES } from './required-scopes';
import type { AuthPrincipal, PatScope } from './auth.types';

@Injectable()
export class PatScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): true {
    const required = this.reflector.getAllAndOverride<PatScope[]>(REQUIRED_PAT_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const principal = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>().user;
    if (!principal) throw new ForbiddenException('缺少认证主体。');
    if (principal.kind === 'browser' || !required?.length) return true;
    if (!required.every((scope) => principal.scopes.includes(scope))) {
      throw new ForbiddenException('PAT 权限不足。');
    }
    return true;
  }
}
