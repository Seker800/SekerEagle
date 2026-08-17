import { Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
  ListEagleImportRunsDto,
} from './eagle-import.dto';
import { EagleImportService } from './eagle-import.service';
import { EagleUploadService } from './eagle-upload.service';
import { EagleImportsService } from './import/eagle-app-import.service';
import { UPLOAD_PART_SIZE_BYTES } from './import/upload-limits';

@ApiTags('eagle-imports')
@ApiCookieAuth()
@ApiBearerAuth()
@Controller('eagle/imports')
@UseGuards(AccessAuthGuard, PatScopeGuard)
export class EagleImportController {
  constructor(
    private readonly legacyImports: EagleImportService,
    private readonly imports: EagleImportsService,
    private readonly uploads: EagleUploadService,
  ) {}

  @Get()
  @RequirePatScopes('import:read')
  listRuns(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListEagleImportRunsDto) {
    return this.imports.listRuns(principal.sub, query);
  }

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
    return this.imports.stageManifestChunk(principal.sub, runId, chunk);
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
    return this.imports.listItems(principal.sub, runId, query as never);
  }

  @Post(':runId/items/:itemId/retry')
  @RequirePatScopes('import:write')
  @UseGuards(BrowserOrPatOriginGuard)
  retryItem(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.imports.retryItem(principal.sub, runId, itemId);
  }

  @Post(':runId/items/:itemId/reset-upload')
  @RequirePatScopes('import:write', 'asset:write')
  @UseGuards(BrowserOrPatOriginGuard)
  resetUpload(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.imports.resetUpload(principal.sub, runId, itemId);
  }

  @Post(':runId/items/:itemId/upload')
  @RequirePatScopes('import:write', 'asset:write')
  @UseGuards(BrowserOrPatOriginGuard)
  async initiateUpload(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    const start = await this.imports.prepareUploadStart(principal.sub, runId, itemId);
    if (start.kind === 'RESUME' || start.kind === 'FINALIZING') {
      if (!start.sessionId) throw new ConflictException('导入项正在完成上传，请稍后重试。');
      const session = await this.uploads.getSession(principal.sub, start.sessionId);
      return { ...session, partSize: UPLOAD_PART_SIZE_BYTES, partSizeBytes: UPLOAD_PART_SIZE_BYTES };
    }
    if (start.kind === 'IMPORTED') {
      throw new ConflictException('导入项已经完成。');
    }
    const item = await this.legacyImports.getUploadItem(principal.sub, runId, itemId);
    const session = await this.uploads.initiate(principal.sub, {
      originalName: item.originalFileName,
      mimeType: item.mimeType,
      size: Number(item.byteSize),
      contentSha256: item.contentSha256 ?? undefined,
    });
    try {
      const binding = await this.imports.bindUploadSession({
        ownerId: principal.sub,
        runId,
        runItemId: itemId,
        uploadSessionId: session.id,
        fileName: item.originalFileName,
        mimeType: item.mimeType,
        size: item.byteSize,
      });
      if (!binding.accepted) throw new ConflictException('导入项已被另一上传会话占用。');
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
    return this.legacyImports.finishItem(principal.sub, runId, itemId, input.assetId);
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

  @Get(':runId/reconcile')
  @RequirePatScopes('import:read')
  reconcile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('runId', new ParseUUIDPipe({ version: '4' })) runId: string,
  ) {
    return this.imports.reconcile(principal.sub, runId);
  }
}
