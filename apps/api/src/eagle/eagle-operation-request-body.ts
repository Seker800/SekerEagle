import { json, type NextFunction, type Request, type Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Byte/memory budget only; a selection has no product-level item count cap. */
export function installOperationRequestBodyParser(app: Pick<NestExpressApplication, 'use'>) {
  const limit = process.env.EAGLE_OPERATION_BODY_LIMIT ?? '32mb';
  const parse = json({ limit });
  app.use(
    [
      /^\/api\/(eagle|photos)\/(operations|assets\/batch(?:\/(?:send|manual-tags|trash|restore))?|assets\/trash|trash\/restore|duplicates\/cleanup|vector\/suggestions\/review-batch)\/?$/,
      /^\/api\/photos\/photography\/(people\/(?:review|merge-selected)|people\/[^/]+\/merge|groups\/(?:manual|[^/]+\/(?:members|merge)))\/?$/,
      /^\/api\/photos\/agent\/tasks\/[^/]+\/(?:review|manual-action)\/?$/,
    ],
    function operationSelectionJson(req: Request, res: Response, next: NextFunction) {
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) parse(req, res, next);
      else next();
    },
  );
}
