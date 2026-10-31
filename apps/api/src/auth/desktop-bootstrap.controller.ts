import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { BrowserOriginGuard } from './browser-origin.guard';
import { DeploymentIdentityService } from './deployment-identity.service';

@Controller('desktop')
export class DesktopBootstrapController {
  constructor(private readonly deploymentIdentity: DeploymentIdentityService) {}

  @Get('bootstrap')
  @UseGuards(BrowserOriginGuard)
  @Header('Cache-Control', 'no-store')
  async bootstrap() {
    return { version: 1 as const, deploymentId: await this.deploymentIdentity.get() };
  }
}
