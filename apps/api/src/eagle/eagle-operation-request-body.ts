import { json, type NextFunction, type Request, type Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Byte/memory budget only; a selection has no product-level item count cap. */
export function installOperationRequestBodyParser(app: Pick<NestExpressApplication, 'use'>) {
  const limit = process.env.EAGLE_OPERATION_BODY_LIMIT ?? '32mb';
  const parse = json({ limit });
  app.use(
    /^\/api\/(eagle|photos)\/operations\/?$/,
    function operationSelectionJson(req: Request, res: Response, next: NextFunction) {
      if (req.method === 'POST') parse(req, res, next);
      else next();
    },
  );
}
