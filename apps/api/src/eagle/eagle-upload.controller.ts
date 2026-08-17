import {
  BadRequestException,
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
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { RequirePatScopes } from '../auth/required-scopes';
import type { AuthPrincipal } from '../auth/auth.types';
import { CompleteEagleUploadDto, InitiateEagleUploadDto } from './eagle-upload.dto';
import { EagleImportsService } from './import/eagle-app-import.service';
import { EagleUploadService } from './eagle-upload.service';

@ApiTags('eagle-uploads')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('eagle/uploads')
@UseGuards(AccessAuthGuard, PatScopeGuard)
@RequirePatScopes('asset:write')
export class EagleUploadController {
  constructor(
    private readonly uploads: EagleUploadService,
    private readonly imports: EagleImportsService,
  ) {}

  @Post()
  @UseGuards(BrowserOrPatOriginGuard)
  initiate(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: InitiateEagleUploadDto) {
    return this.uploads.initiate(principal.sub, input);
  }

  @Get(':uploadSessionId')
  getSession(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
  ) {
    return this.uploads.getSession(principal.sub, uploadSessionId);
  }

  @Post(':uploadSessionId/parts/:partNumber')
  @UseGuards(BrowserOrPatOriginGuard)
  presignPart(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ) {
    return this.uploads.presignPart(principal.sub, uploadSessionId, partNumber);
  }

  @Get(':uploadSessionId/parts')
  listParts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
  ) {
    return this.uploads.listParts(principal.sub, uploadSessionId);
  }

  @Post(':uploadSessionId/complete')
  @UseGuards(BrowserOrPatOriginGuard)
  async complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
    @Body() input: CompleteEagleUploadDto,
  ) {
    try {
      const completed = await this.uploads.complete(principal.sub, uploadSessionId, input);
      await this.imports.finalizeUpload(principal.sub, uploadSessionId, completed.assetId);
      return completed;
    } catch (error) {
      const permanent = error instanceof BadRequestException;
      await this.imports
        .markUploadFailed(principal.sub, uploadSessionId, error, {
          terminal: permanent,
          permanent,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  @Delete(':uploadSessionId')
  @UseGuards(BrowserOrPatOriginGuard)
  abort(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
  ) {
    return this.uploads.abort(principal.sub, uploadSessionId);
  }
}
