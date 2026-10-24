import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleProcessingService } from './eagle-processing.service';
import { UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

@Controller('eagle/tasks')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class EagleTaskCenterController {
  constructor(private readonly tasks: EagleTaskCenterService, private readonly processing: EagleProcessingService) {}
  @Get()
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tasks.overview(principal.sub, principal.canViewPrivate);
  }
  @Patch('settings')
  @UseGuards(BrowserOriginGuard)
  settings(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: UpdateEagleProcessingSettingsDto) {
    return this.processing.updateSettings(principal.sub, input);
  }
}
