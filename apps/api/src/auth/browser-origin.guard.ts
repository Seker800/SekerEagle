import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isTrustedLocalNetworkHost } from '../config/runtime-config';

function resolveOrigin(request: Request): string | null {
  const origin = request.headers.origin?.trim();
  if (origin) {
    try {
      const parsed = new URL(origin);
      return parsed.origin === origin && ['http:', 'https:'].includes(parsed.protocol)
        ? parsed.origin
        : null;
    } catch {
      return null;
    }
  }
  const referer = request.headers.referer?.trim();
  if (!referer) return null;
  try {
    const parsed = new URL(referer);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function resolveRequestOrigin(request: Request): URL | null {
  const host = request.headers.host?.trim();
  if (!host || !['http', 'https'].includes(request.protocol)) return null;
  try {
    const origin = new URL(`${request.protocol}://${host}`);
    if (
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

function isSamePrivateNetworkOrigin(request: Request, sourceOrigin: string): boolean {
  const requestOrigin = resolveRequestOrigin(request);
  return (
    requestOrigin !== null &&
    sourceOrigin === requestOrigin.origin &&
    isTrustedLocalNetworkHost(requestOrigin.hostname)
  );
}

@Injectable()
export class BrowserOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): true {
    const request = context.switchToHttp().getRequest<Request>();
    const trustedOrigins = this.config.getOrThrow<readonly string[]>('BROWSER_TRUSTED_ORIGINS');
    const sourceOrigin = resolveOrigin(request);
    if (
      sourceOrigin === null ||
      (!trustedOrigins.includes(sourceOrigin) && !isSamePrivateNetworkOrigin(request, sourceOrigin))
    ) {
      throw new ForbiddenException({ code: 'ORIGIN_REJECTED', message: '请求来源不受信任。' });
    }
    return true;
  }
}
