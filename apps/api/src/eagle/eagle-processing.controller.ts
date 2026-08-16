import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { EagleProcessingService } from './eagle-processing.service';
import { ListEagleProcessingJobsDto, UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

@Controller('admin/eagle-processing')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard, AdminGuard)
export class EagleProcessingController {
  constructor(private readonly processing: EagleProcessingService) {}

  @Get('summary') summary(@CurrentPrincipal() principal: AuthPrincipal) { return this.processing.summary(principal.sub); }
  @Get('jobs') jobs(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListEagleProcessingJobsDto) { return this.processing.jobs(principal.sub, query); }

  @Post('jobs/:jobId/retry')
  @UseGuards(BrowserOriginGuard)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string) { return this.processing.retry(principal.sub, jobId); }

  @Post('retry-failed')
  @UseGuards(BrowserOriginGuard)
  retryFailed(@CurrentPrincipal() principal: AuthPrincipal) { return this.processing.retryFailed(principal.sub); }

  @Post('reconcile')
  @UseGuards(BrowserOriginGuard)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal) { return this.processing.reconcile(principal.sub); }

  @Patch('settings')
  @UseGuards(BrowserOriginGuard)
  settings(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: UpdateEagleProcessingSettingsDto) { return this.processing.updateSettings(principal.sub, input); }
}
