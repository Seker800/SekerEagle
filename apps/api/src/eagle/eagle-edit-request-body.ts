import { json, type NextFunction, type Request, type Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
/** Only parameter saves accept a portable LUT; ordinary JSON retains its existing small limit. */
export function installEditRequestBodyParser(app: Pick<NestExpressApplication, 'use'>) {
  const parse = json({ limit: '5mb' });
  app.use(
    /^\/api\/(eagle|photos)\/assets\/[0-9a-f-]{36}\/edit-renders\/?$/i,
    function editRenderJson(req: Request, res: Response, next: NextFunction) {
      if (req.method === 'POST') parse(req, res, next);
      else next();
    },
  );
}
