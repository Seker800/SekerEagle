import type { Request, Response, NextFunction } from 'express';

export function securityResponse(_request: Request, response: Response, next: NextFunction): void {
  response.removeHeader('X-Powered-By');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  // All API metadata is private. Media controllers explicitly opt into revalidation caching.
  response.setHeader('Cache-Control', 'no-store');
  next();
}
