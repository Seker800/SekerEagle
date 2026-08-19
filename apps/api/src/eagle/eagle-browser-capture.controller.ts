import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { RequirePatScopes } from '../auth/required-scopes';
import type { AuthPrincipal } from '../auth/auth.types';
import { InitiateEagleBrowserCaptureDto } from './eagle-browser-capture.dto';
import { EagleBrowserCaptureService } from './eagle-browser-capture.service';
import { CompleteEagleUploadDto } from './eagle-upload.dto';

@ApiTags('eagle-browser-captures')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('eagle/browser-captures')
@SkipThrottle({ default: true })
@UseGuards(AccessAuthGuard, PatScopeGuard)
@RequirePatScopes('capture:write')
export class EagleBrowserCaptureController {
  constructor(private readonly captures: EagleBrowserCaptureService) {}

  @Post()
  @UseGuards(BrowserOrPatOriginGuard)
  initiate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: InitiateEagleBrowserCaptureDto,
  ) {
    return this.captures.initiate(principal.sub, input);
  }

  @Get(':clientCaptureId')
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('clientCaptureId', new ParseUUIDPipe({ version: '4' })) clientCaptureId: string,
  ) {
    return this.captures.get(principal.sub, clientCaptureId);
  }

  @Post(':clientCaptureId/parts/:partNumber')
  @UseGuards(BrowserOrPatOriginGuard)
  presignPart(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('clientCaptureId', new ParseUUIDPipe({ version: '4' })) clientCaptureId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ) {
    return this.captures.presignPart(principal.sub, clientCaptureId, partNumber);
  }

  @Get(':clientCaptureId/parts')
  listParts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('clientCaptureId', new ParseUUIDPipe({ version: '4' })) clientCaptureId: string,
  ) {
    return this.captures.listParts(principal.sub, clientCaptureId);
  }

  @Post(':clientCaptureId/complete')
  @UseGuards(BrowserOrPatOriginGuard)
  complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('clientCaptureId', new ParseUUIDPipe({ version: '4' })) clientCaptureId: string,
    @Body() input: CompleteEagleUploadDto,
  ) {
    return this.captures.complete(principal.sub, clientCaptureId, input);
  }

  @Delete(':clientCaptureId')
  @UseGuards(BrowserOrPatOriginGuard)
  abort(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('clientCaptureId', new ParseUUIDPipe({ version: '4' })) clientCaptureId: string,
  ) {
    return this.captures.abort(principal.sub, clientCaptureId);
  }
}
