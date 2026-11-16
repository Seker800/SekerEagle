import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiCreatedResponse } from '@nestjs/swagger';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { RequirePatScopes } from '../auth/required-scopes';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CheckUploadContentBatchDto,
  CheckUploadContentBatchResultDto,
  CheckUploadContentDto,
  CheckUploadContentResultDto,
  CompleteEagleUploadDto,
  InitiateEagleUploadDto,
  UploadStatusBatchDto,
  UploadStatusBatchResultDto,
} from './eagle-upload.dto';
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
    return this.uploads.initiate(principal.sub, input, principal.canViewPrivate === true);
  }

  @Post('check-content')
  @ApiCreatedResponse({ type: CheckUploadContentResultDto })
  @UseGuards(BrowserOrPatOriginGuard)
  checkContent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: CheckUploadContentDto,
  ): Promise<CheckUploadContentResultDto> {
    return this.uploads.checkContent(principal.sub, input, principal.canViewPrivate === true);
  }

  @Post('check-content-batch')
  @ApiCreatedResponse({ type: CheckUploadContentBatchResultDto })
  @UseGuards(BrowserOrPatOriginGuard)
  checkContentBatch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: CheckUploadContentBatchDto,
  ): Promise<CheckUploadContentBatchResultDto> {
    return this.uploads.checkContentBatch(
      principal.sub,
      input.items,
      principal.canViewPrivate === true,
    );
  }

  @Post('status-batch')
  @ApiCreatedResponse({ type: UploadStatusBatchResultDto })
  @UseGuards(BrowserOrPatOriginGuard)
  getStatusBatch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: UploadStatusBatchDto,
  ): Promise<UploadStatusBatchResultDto> {
    return this.uploads.getSessions(principal.sub, input.uploadSessionIds);
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
  @HttpCode(202)
  @UseGuards(BrowserOrPatOriginGuard)
  async complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('uploadSessionId', new ParseUUIDPipe({ version: '4' })) uploadSessionId: string,
    @Body() input: CompleteEagleUploadDto,
  ) {
    try {
      // The HTTP request only assembles the object and accepts the finalization job.
      // Inspection and publication run in the independent operations process.
      return await this.uploads.complete(principal.sub, uploadSessionId, input);
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
