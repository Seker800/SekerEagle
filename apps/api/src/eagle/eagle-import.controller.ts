import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOrPatOriginGuard } from '../auth/browser-or-pat-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { RequirePatScopes } from '../auth/required-scopes';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CreateEagleImportRunDto,
  EagleImportManifestChunkDto,
  FinishEagleImportItemDto,
  ListEagleImportItemsDto,
} from './eagle-import.dto';
import { EagleImportService } from './eagle-import.service';
import { EagleUploadService } from './eagle-upload.service';

@ApiTags('eagle-imports')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('eagle/imports')
@UseGuards(AccessAuthGuard, PatScopeGuard)
export class EagleImportController {
  constructor(
    private readonly imports: EagleImportService,
    private readonly uploads: EagleUploadService,
  ) {}

  @Get('libraries')
  @RequirePatScopes('import:read')
  listLibraries(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.imports.listLibraries(principal.sub);
  }

  @Post()
  @RequirePatScopes('import:write')
  @UseGuards(BrowserOrPatOriginGuard)
  createRun(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateEagleImportRunDto) {
    return this.imports.createRun(principal.sub, input);
  }

  @Get(':runId')
  @RequirePatScopes('import:read')
  getRun(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.imports.getRun(principal.sub, runId);
  }

  @Post(':runId/manifest/chunks')
  @RequirePatScopes('import:write')
  @UseGuards(BrowserOrPatOriginGuard)
  stageChunk(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Body() chunk: EagleImportManifestChunkDto,
  ) {
    return this.imports.stageChunk(principal.sub, runId, chunk);
  }

  @Post(':runId/preflight')
  @RequirePatScopes('import:write')
  @UseGuards(BrowserOrPatOriginGuard)
  preflight(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.imports.preflight(principal.sub, runId);
  }

  @Get(':runId/items')
  @RequirePatScopes('import:read')
  listItems(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Query() query: ListEagleImportItemsDto,
  ) {
    return this.imports.listItems(principal.sub, runId, query);
  }

  @Post(':runId/items/:itemId/upload')
  @RequirePatScopes('import:write', 'asset:write')
  @UseGuards(BrowserOrPatOriginGuard)
  async initiateUpload(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    const item = await this.imports.getUploadItem(principal.sub, runId, itemId);
    const session = await this.uploads.initiate(principal.sub, {
      originalName: item.originalFileName,
      mimeType: item.mimeType,
      size: Number(item.byteSize),
      contentSha256: item.contentSha256 ?? undefined,
    });
    try {
      await this.imports.markUploading(principal.sub, runId, itemId, session.id);
    } catch (error) {
      await this.uploads.abort(principal.sub, session.id).catch(() => undefined);
      throw error;
    }
    return { ...session, partSizeBytes: session.partSize };
  }

  @Post(':runId/items/:itemId/finish')
  @RequirePatScopes('import:write', 'asset:write')
  @UseGuards(BrowserOrPatOriginGuard)
  finishItem(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body() input: FinishEagleImportItemDto,
  ) {
    return this.imports.finishItem(principal.sub, runId, itemId, input.assetId);
  }

  @Post(':runId/cancel')
  @RequirePatScopes('import:write')
  @UseGuards(BrowserOrPatOriginGuard)
  cancel(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.imports.cancel(principal.sub, runId);
  }
}
