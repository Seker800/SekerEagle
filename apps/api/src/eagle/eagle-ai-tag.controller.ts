import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { UpdateEagleAiTagSettingsDto } from './eagle-ai-tag.dto';
import { EagleAiTagService } from './eagle-ai-tag.service';

@Controller('eagle/ai-tags')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class EagleAiTagController {
  constructor(private readonly aiTags: EagleAiTagService) {}

  @Get('summary')
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.aiTags.summary(principal.sub, principal.canViewPrivate);
  }

  @Post('scan-missing')
  @UseGuards(BrowserOriginGuard)
  scanMissing(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.aiTags.scanMissing(principal.sub, principal.canViewPrivate);
  }

  @Post('retry-failed')
  @UseGuards(BrowserOriginGuard)
  retryFailed(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.aiTags.retryFailed(principal.sub, principal.canViewPrivate);
  }

  @Patch('settings')
  @UseGuards(BrowserOriginGuard)
  updateSettings(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: UpdateEagleAiTagSettingsDto,
  ) {
    return this.aiTags.updateSettings(principal.sub, input);
  }
}
