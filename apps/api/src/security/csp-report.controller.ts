import { Controller, HttpCode, Post } from '@nestjs/common';

/** Collector for `report-uri`; reports are intentionally not logged or persisted. */
@Controller('security')
export class CspReportController {
  @Post('csp-report')
  @HttpCode(204)
  report(): void {}
}
