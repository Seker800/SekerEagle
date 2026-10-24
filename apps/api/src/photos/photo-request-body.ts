import { json, type NextFunction, type Request, type Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Register before initialization; only grouped requests receive the larger, bounded body budget. */
export function installPhotoRequestBodyParser(app: Pick<NestExpressApplication, 'use'>) {
  const parse = json({ limit: '2mb' });
  // Nest detects a global parser by its function name. Keep this scoped parser distinct,
  // so registering it cannot accidentally suppress JSON parsing on the other API routes.
  app.use(
    '/api/photos/agent/requests',
    function photoRequestJson(req: Request, res: Response, next: NextFunction) {
      parse(req, res, next);
    },
  );
}
