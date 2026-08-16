import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types';
import { BrowserOriginGuard } from './browser-origin.guard';

@Injectable()
export class BrowserOrPatOriginGuard implements CanActivate {
  constructor(private readonly browserOrigin: BrowserOriginGuard) {}

  canActivate(context: ExecutionContext): true {
    const principal = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>().user;
    if (principal?.kind === 'pat') return true;
    return this.browserOrigin.canActivate(context);
  }
}
