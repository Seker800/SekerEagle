import type { Request, Response, NextFunction } from 'express';

export function securityResponse(request: Request, response: Response, next: NextFunction): void {
  response.removeHeader('X-Powered-By');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (/^\/api\/(?:auth(?:\/|$)|tokens(?:\/|$)|admin(?:\/|$))/.test(request.path)) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }
  next();
}
