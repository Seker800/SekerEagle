import { BatchEditRendersDto } from './eagle-batch-edit';
import { libraryCommandPayload } from './eagle-library-command';
import { randomUUID } from 'node:crypto';
import { EagleDuplicateService } from './eagle-duplicates.service';
import {
  DuplicateActionDto,
  DuplicateIgnoreDto,
  DuplicateListDto,
  DuplicateScanDto,
} from './eagle-duplicates.dto';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import {
  EnqueueAssetOperationDto,
  ListAssetOperationsDto,
  AssetOperationResultsDto,
  UndoAssetOperationDto,
} from './eagle-asset-operations.dto';
import { CreateEditRenderDto } from './eagle-edit-render';
import { AssetTimelineDto, AssetTimelineResponseDto } from './eagle.dto';
import { safeMediaResponse } from '../common/media-response';
import { SaveEagleEditRecipeDto } from './eagle-edit-recipe';
import { EagleMediaCapabilitiesDto } from './eagle-media-capability.dto';
import { EagleAssetUpdateResponseDto } from './eagle-asset-update.dto';
import {
  EagleAssetPageResponseDto,
  EagleAssetResponseDto,
  EagleAssetListResponseDto,
} from './eagle-asset-response.dto';
import {
  EagleOperationResultsResponseDto,
  EagleOperationSummaryResponseDto,
  EagleDuplicateAdmissionResponseDto,
} from './eagle-operation-response.dto';
import { Optional } from '@nestjs/common';
import { SendEagleAssetsDto } from './eagle.dto';
import {
  Body,
  HttpCode,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiTags,
  ApiHeader,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Readable } from 'node:stream';
import {
  isObjectRangeNotSatisfiableError,
  parseRangeHeader,
  RangeNotSatisfiableException,
  setPartialContentHeaders,
  setRangeNotSatisfiableHeaders,
} from '../common/range-parser';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CreateManualTagDto,
  BatchChangeEagleManualTagsDto,
  BatchUpdateEagleAssetsDto,
  CountEagleAssetsDto,
  CreateManualTagGroupDto,
  CreateSmartFolderDto,
  EagleAssetIdsDto,
  ListEagleAssetsDto,
  ListEagleAssetUpdatesDto,
  MoveSmartFolderDto,
  ReplaceAssetTagsDto,
  UpdateEagleAssetDto,
  UpdateManualTagDto,
  UpdateManualTagGroupDto,
  UpdateEaglePrivacySettingsDto,
  EaglePrivacySettingsDto,
  UpdateSmartFolderDto,
} from './eagle.dto';
import { EagleService } from './eagle.service';
import { EaglePrivacyService } from './eagle-privacy.service';
import { EagleMediaService } from './eagle-media.service';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';

@ApiTags('eagle')
@ApiCookieAuth()
@Controller('eagle')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class EagleController {
  constructor(
    private readonly mediaCapabilities: EagleMediaCapabilityService,
    private readonly eagle: EagleService,
    private readonly media: EagleMediaService,
    private readonly privacy: EaglePrivacyService,
    @Optional() private readonly operations?: EagleAssetOperationService,
    @Optional() private readonly duplicates?: EagleDuplicateService,
  ) {}

  @Get('duplicates')
  listDuplicates(@CurrentPrincipal() principal: AuthPrincipal, @Query() input: DuplicateListDto) {
    return this.duplicates!.list(principal.sub, principal.canViewPrivate, input);
  }
  @Get('duplicates/:signature/members')
  duplicateMembers(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('signature') signature: string,
    @Query() input: DuplicateListDto,
  ) {
    return this.duplicates!.members(
      principal.sub,
      principal.canViewPrivate,
      signature,
      Number(input.cursor ?? 0),
      input,
    );
  }
  @Post('duplicates/scan')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleDuplicateAdmissionResponseDto })
  @UseGuards(BrowserOriginGuard)
  scanDuplicates(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: DuplicateScanDto) {
    return this.duplicates!.scan(principal, input.operationId, input.onlyIfUnattempted);
  }
  @Post('duplicates/cleanup')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleDuplicateAdmissionResponseDto })
  @UseGuards(BrowserOriginGuard)
  cleanupDuplicates(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: DuplicateActionDto,
  ) {
    return this.duplicates!.cleanup(principal, input);
  }
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('duplicates/ignore')
  @UseGuards(BrowserOriginGuard)
  ignoreDuplicates(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: DuplicateIgnoreDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'DUPLICATE_IGNORE',
      payload: libraryCommandPayload(input),
    });
  }

  @ApiCreatedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('operations')
  @UseGuards(BrowserOriginGuard)
  enqueueOperation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: EnqueueAssetOperationDto,
  ) {
    if (!this.operations) throw new Error('Asset operation service is unavailable');
    return this.operations.enqueue(principal, input);
  }
  @ApiOkResponse({ type: [EagleOperationSummaryResponseDto] })
  @Get('operations')
  listOperations(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListAssetOperationsDto,
  ) {
    if (!this.operations) throw new Error('Asset operation service is unavailable');
    return this.operations.list(
      principal.sub,
      principal.canViewPrivate && query.publicOnly !== 'true',
    );
  }
  @ApiOkResponse({ type: EagleOperationResultsResponseDto })
  @Get('operations/:operationId/results')
  operationResults(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('operationId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: AssetOperationResultsDto,
  ) {
    return this.operations!.results(principal, id, query);
  }
  @ApiCreatedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('operations/:operationId/undo')
  @UseGuards(BrowserOriginGuard)
  undoOperation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('operationId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UndoAssetOperationDto,
  ) {
    return this.operations!.undo(principal, id, input.operationId);
  }
  @ApiCreatedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('operations/:operationId/retry')
  @UseGuards(BrowserOriginGuard)
  retryOperation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('operationId', new ParseUUIDPipe({ version: '4' })) operationId: string,
  ) {
    if (!this.operations) throw new Error('Asset operation service is unavailable');
    return this.operations.retry(principal, operationId);
  }
  @ApiCreatedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('operations/:operationId/cancel')
  @UseGuards(BrowserOriginGuard)
  cancelOperation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('operationId', new ParseUUIDPipe({ version: '4' })) operationId: string,
  ) {
    if (!this.operations) throw new Error('Asset operation service is unavailable');
    return this.operations.cancel(principal, operationId);
  }

  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @Post('assets/batch/send')
  @HttpCode(202)
  @UseGuards(BrowserOriginGuard)
  sendAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: SendEagleAssetsDto) {
    if (!this.operations) throw new Error('Asset operation service is unavailable');
    return this.operations.enqueue(principal, { ...input, kind: 'SEND' });
  }

  @Get('media-capabilities')
  @ApiOkResponse({ type: EagleMediaCapabilitiesDto })
  getMediaCapabilities() {
    return this.mediaCapabilities.getCapabilities();
  }

  @Post('assets/batch/edit-renders')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @UseGuards(BrowserOriginGuard)
  batchEditRenders(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchEditRendersDto,
  ) {
    const { assetIds, operationId, ...payload } = input;
    return this.operations!.enqueueCommand(principal, {
      operationId,
      type: 'BATCH_EDIT_RENDER',
      assetIds,
      payload: libraryCommandPayload(payload),
    });
  }

  @Post('assets/:assetId/edit-renders')
  @UseGuards(BrowserOriginGuard)
  createEditRender(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: CreateEditRenderDto,
  ) {
    return this.eagle.createEditRender(principal.sub, id, input, principal.canViewPrivate);
  }
  @Get('assets/:assetId/edit-renders/:jobId')
  readEditRender(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.eagle.readEditRender(principal.sub, id, jobId, principal.canViewPrivate);
  }
  @Get('assets/:assetId/edit-recipe')
  getEditRecipe(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', ParseUUIDPipe) id: string,
  ) {
    return this.eagle
      .getEditRecipe(principal.sub, id, principal.canViewPrivate)
      .then((entry) => ({ entry }));
  }
  @Put('assets/:assetId/edit-recipe')
  @UseGuards(BrowserOriginGuard)
  saveEditRecipe(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: SaveEagleEditRecipeDto,
  ) {
    return this.eagle.saveEditRecipe(principal.sub, id, input, principal.canViewPrivate);
  }
  @ApiOkResponse({ type: EagleAssetPageResponseDto })
  @Get('assets')
  listAssets(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListEagleAssetsDto,
  ): Promise<EagleAssetPageResponseDto> {
    return this.eagle.listAssets(principal.sub, query, {
      includePrivate: principal.canViewPrivate,
    });
  }

  @Post('assets/filter-count')
  @UseGuards(BrowserOriginGuard)
  countAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CountEagleAssetsDto) {
    return this.eagle.countAssets(principal.sub, input.query, principal.canViewPrivate);
  }

  @ApiOkResponse({ type: [EagleAssetUpdateResponseDto] })
  @Get('asset-updates')
  listAssetUpdates(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListEagleAssetUpdatesDto,
  ) {
    return this.eagle.listUpdates(principal.sub, query.assetIds, principal.canViewPrivate);
  }

  @ApiOkResponse({ type: [EagleAssetUpdateResponseDto] })
  @Post('asset-updates')
  @UseGuards(BrowserOriginGuard)
  listAssetUpdatesByBody(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: EagleAssetIdsDto,
  ) {
    return this.eagle.listUpdates(principal.sub, input.assetIds, principal.canViewPrivate);
  }

  @ApiOkResponse({ type: AssetTimelineResponseDto })
  @Get('assets/timeline')
  assetTimeline(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: AssetTimelineDto) {
    return this.eagle.assetTimeline(principal.sub, query.sort, query.timeZone);
  }

  @Get('assets/:assetId/location')
  locateAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.eagle.locateAsset(principal.sub, assetId, principal.canViewPrivate);
  }

  @ApiOkResponse({ type: EagleAssetResponseDto })
  @Get('assets/:assetId')
  getAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.eagle.getAsset(principal.sub, assetId, {
      includePrivate: principal.canViewPrivate,
    });
  }

  @ApiOkResponse({ type: EagleAssetResponseDto })
  @Get('trash/:assetId')
  getTrashAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.eagle.getAsset(principal.sub, assetId, {
      trash: true,
      includePrivate: principal.canViewPrivate,
    });
  }

  @Get('assets/:assetId/original')
  async getOriginal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abortSignal = createMediaAbortSignal(response);
    let parsedRange: string | undefined;
    try {
      parsedRange = parseRangeHeader(range);
    } catch {
      const metadata = await this.media.getOriginalMetadata(
        principal.sub,
        assetId,
        principal.canViewPrivate,
      );
      setRangeNotSatisfiableHeaders(response, metadata.size);
      return;
    }
    let media: Awaited<ReturnType<EagleMediaService['getOriginal']>>;
    try {
      media = await this.media.getOriginal(
        principal.sub,
        assetId,
        parsedRange,
        ifNoneMatch,
        principal.canViewPrivate,
        abortSignal,
      );
    } catch (error) {
      if (!isObjectRangeNotSatisfiableError(error)) throw error;
      const metadata = await this.media.getOriginalMetadata(
        principal.sub,
        assetId,
        principal.canViewPrivate,
      );
      setRangeNotSatisfiableHeaders(response, metadata.size);
      return;
    }
    applyMediaHeaders(
      response,
      media,
      principal.canViewPrivate ? 'private, no-store' : 'private, no-cache',
    );
    if (media.notModified) {
      response.status(304);
      return;
    }
    setPartialContentHeaders(
      response,
      parsedRange,
      media.contentRange,
      media.contentLength,
      media.fullSize,
    );
    bindMediaStreamLifetime(response, media.stream!);
    return new StreamableFile(media.stream!);
  }

  @Get('assets/:assetId/content')
  getOriginalContent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getOriginal(principal, assetId, range, ifNoneMatch, response);
  }

  @ApiHeader({
    name: 'range',
    required: false,
    description: 'Optional single byte range for video playback',
    schema: { type: 'string' },
  })
  @Get('assets/:assetId/renditions/:renditionId')
  async getRendition(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Param('renditionId', new ParseUUIDPipe({ version: '4' })) renditionId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Headers('range') range?: string,
  ) {
    const abortSignal = createMediaAbortSignal(response);
    let media: Awaited<ReturnType<EagleMediaService['getRendition']>>;
    try {
      media = await this.media.getRendition(
        principal.sub,
        assetId,
        renditionId,
        ifNoneMatch,
        principal.canViewPrivate,
        abortSignal,
        range,
      );
    } catch (error) {
      if (!(error instanceof RangeNotSatisfiableException)) throw error;
      setRangeNotSatisfiableHeaders(response, error.fullSize);
      return;
    }
    applyMediaHeaders(
      response,
      media,
      media.desktopCacheEligible ? 'private, no-cache' : 'private, no-store',
    );
    if (media.notModified) {
      response.status(304);
      return;
    }
    setPartialContentHeaders(
      response,
      range,
      media.contentRange,
      media.contentLength,
      media.fullSize,
    );
    bindMediaStreamLifetime(response, media.stream!);
    return new StreamableFile(media.stream!);
  }

  @ApiHeader({
    name: 'range',
    required: false,
    description: 'Optional single byte range for video playback',
    schema: { type: 'string' },
  })
  @Get('assets/:assetId/renditions/:renditionId/content')
  getRenditionContent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Param('renditionId', new ParseUUIDPipe({ version: '4' })) renditionId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Headers('range') range?: string,
  ) {
    return this.getRendition(principal, assetId, renditionId, ifNoneMatch, response, range);
  }

  @Get('assets/:assetId/pyramid')
  getPyramidDescriptor(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.media.getPyramidDescriptor(principal.sub, assetId, principal.canViewPrivate);
  }

  @Get('assets/:assetId/pyramids/:pyramidId/tiles/:level/:x/:y')
  async getPyramidTile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Param('pyramidId', new ParseUUIDPipe({ version: '4' })) pyramidId: string,
    @Param('level', ParseIntPipe) level: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abortSignal = createMediaAbortSignal(response);
    const media = await this.media.getPyramidTile(
      principal.sub,
      assetId,
      pyramidId,
      level,
      x,
      y,
      ifNoneMatch,
      principal.canViewPrivate,
      abortSignal,
    );
    applyMediaHeaders(
      response,
      media,
      media.desktopCacheEligible ? 'private, no-cache' : 'private, no-store',
    );
    if (media.notModified) {
      response.status(304);
      return;
    }
    bindMediaStreamLifetime(response, media.stream!);
    return new StreamableFile(media.stream!);
  }

  @Post('assets/facts')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: [EagleAssetListResponseDto] })
  listAssetFacts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: EagleAssetIdsDto,
    @Query('publicOnly') publicOnly?: string,
  ) {
    return this.eagle.listAssetFacts(
      principal.sub,
      input.assetIds,
      principal.canViewPrivate && publicOnly !== 'true',
    );
  }

  @Patch('assets/batch')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  batchUpdate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchUpdateEagleAssetsDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'ASSET_UPDATE',
      assetIds: input.assets.map(({ assetId }) => assetId),
      payload: libraryCommandPayload(input),
    });
  }

  @Patch('assets/:assetId')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  updateAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: UpdateEagleAssetDto,
  ) {
    const { rowVersion, ...changes } = input;
    return this.operations!.enqueueCommand(principal, {
      type: 'ASSET_UPDATE',
      assetIds: [assetId],
      payload: libraryCommandPayload({ ...changes, assets: [{ assetId, rowVersion }] }),
    });
  }

  @Get('privacy-settings')
  @ApiOkResponse({ type: EaglePrivacySettingsDto })
  getPrivacySettings(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.privacy.getSettings(principal.sub);
  }

  @Put('privacy-settings')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  updatePrivacySettings(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: UpdateEaglePrivacySettingsDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'PRIVACY_SETTINGS',
      payload: libraryCommandPayload(input),
    });
  }

  @Post('assets/trash')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  trashAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.operations!.enqueue(principal, {
      operationId: randomUUID(),
      kind: 'TRASH',
      assetIds: input.assetIds,
    });
  }

  @Post('assets/batch/trash')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  batchTrash(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.operations!.enqueue(principal, {
      operationId: randomUUID(),
      kind: 'TRASH',
      assetIds: input.assetIds,
    });
  }

  @Post('assets/batch/restore')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  batchRestore(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.operations!.enqueue(principal, {
      operationId: randomUUID(),
      kind: 'RESTORE',
      assetIds: input.assetIds,
    });
  }

  @ApiOkResponse({ type: EagleAssetPageResponseDto })
  @Get('trash')
  listTrash(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListEagleAssetsDto,
  ): Promise<EagleAssetPageResponseDto> {
    return this.eagle.listAssets(principal.sub, query, {
      trash: true,
      includePrivate: principal.canViewPrivate,
    });
  }

  @Post('trash/restore')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  restoreAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.operations!.enqueue(principal, {
      operationId: randomUUID(),
      kind: 'RESTORE',
      assetIds: input.assetIds,
    });
  }

  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @HttpCode(202)
  @Delete('trash')
  @UseGuards(BrowserOriginGuard)
  emptyTrash(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.enqueueOperation(principal, {
      operationId: randomUUID(),
      kind: 'EMPTY_TRASH',
      assetIds: [],
    });
  }

  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @HttpCode(202)
  @Post('trash/empty')
  @UseGuards(BrowserOriginGuard)
  emptyTrashCompat(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.emptyTrash(principal);
  }

  @Get(['tags', 'manual-tags'])
  listTags(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listManualTags(principal.sub, principal.canViewPrivate);
  }

  @Post(['tags', 'manual-tags'])
  @UseGuards(BrowserOriginGuard)
  createTag(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateManualTagDto) {
    return this.eagle.createManualTag(principal.sub, input);
  }

  @Patch(['tags/:tagId', 'manual-tags/:tagId'])
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  updateTag(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
    @Body() input: UpdateManualTagDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'TAG_UPDATE',
      payload: libraryCommandPayload({ tagId, input }),
    });
  }

  @Delete(['tags/:tagId', 'manual-tags/:tagId'])
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  deleteTag(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
  ) {
    return this.operations!.enqueueCommand(principal, { type: 'TAG_DELETE', payload: { tagId } });
  }

  @Get(['tag-groups', 'manual-tag-groups'])
  listTagGroups(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listManualTagGroups(principal.sub, principal.canViewPrivate);
  }

  @Post(['tag-groups', 'manual-tag-groups'])
  @UseGuards(BrowserOriginGuard)
  createTagGroup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: CreateManualTagGroupDto,
  ) {
    return this.eagle.createManualTagGroup(principal.sub, input);
  }

  @Patch(['tag-groups/:groupId', 'manual-tag-groups/:groupId'])
  @UseGuards(BrowserOriginGuard)
  updateTagGroup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
    @Body() input: UpdateManualTagGroupDto,
  ) {
    return this.eagle.updateManualTagGroup(principal.sub, groupId, input);
  }

  @Delete(['tag-groups/:groupId', 'manual-tag-groups/:groupId'])
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  deleteTagGroup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'TAG_GROUP_DELETE',
      payload: { groupId },
    });
  }

  @Get('ai-tags')
  listAiTags(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listAiTags(principal.sub, principal.canViewPrivate);
  }

  @Put('assets/:assetId/tags')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  replaceAssetTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: ReplaceAssetTagsDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'ASSET_TAGS_REPLACE',
      assetIds: [assetId],
      payload: libraryCommandPayload(input),
    });
  }

  @Put('assets/:assetId/manual-tags')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  replaceAssetManualTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: ReplaceAssetTagsDto,
  ) {
    return this.operations!.enqueueCommand(principal, {
      type: 'ASSET_TAGS_REPLACE',
      assetIds: [assetId],
      payload: libraryCommandPayload(input),
    });
  }

  @Post('assets/batch/manual-tags')
  @UseGuards(BrowserOriginGuard)
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  batchChangeManualTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchChangeEagleManualTagsDto,
  ) {
    const { assetIds, ...changes } = input;
    return this.operations!.enqueueCommand(principal, {
      type: 'ASSET_TAGS',
      assetIds,
      payload: libraryCommandPayload(changes),
    });
  }

  @Get('smart-folders')
  listSmartFolders(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listSmartFolders(principal.sub);
  }

  @Post('smart-folders')
  @UseGuards(BrowserOriginGuard)
  createSmartFolder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: CreateSmartFolderDto,
  ) {
    return this.eagle.createSmartFolder(principal.sub, input);
  }

  @Patch('smart-folders/:folderId')
  @UseGuards(BrowserOriginGuard)
  updateSmartFolder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('folderId', new ParseUUIDPipe({ version: '4' })) folderId: string,
    @Body() input: UpdateSmartFolderDto,
  ) {
    return this.eagle.updateSmartFolder(principal.sub, folderId, input);
  }

  @Post('smart-folders/:folderId/move')
  @UseGuards(BrowserOriginGuard)
  moveSmartFolder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('folderId', new ParseUUIDPipe({ version: '4' })) folderId: string,
    @Body() input: MoveSmartFolderDto,
  ) {
    return this.eagle.moveSmartFolder(principal.sub, folderId, input);
  }

  @Delete('smart-folders/:folderId')
  @UseGuards(BrowserOriginGuard)
  deleteSmartFolder(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('folderId', new ParseUUIDPipe({ version: '4' })) folderId: string,
  ) {
    return this.eagle.deleteSmartFolder(principal.sub, folderId);
  }
}

export function bindMediaStreamLifetime(response: Response, stream: Readable): void {
  response.once('close', () => {
    if (!response.writableEnded && !stream.destroyed) stream.destroy();
  });
}

export function createMediaAbortSignal(response: Response): AbortSignal {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableEnded) controller.abort(new Error('媒体客户端已断开。'));
  });
  return controller.signal;
}

function applyMediaHeaders(
  response: Response,
  media: {
    fileName: string;
    mimeType: string;
    contentLength?: number;
    etag?: string;
    lastModified?: Date;
    desktopCacheEligible?: boolean;
  },
  cacheControl: string,
): void {
  const policy = safeMediaResponse(media.mimeType, media.fileName);
  response.setHeader('Content-Type', policy.type);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Disposition', policy.disposition);
  response.setHeader('Cache-Control', cacheControl);
  response.vary('Authorization');
  if (media.contentLength !== undefined)
    response.setHeader('Content-Length', String(media.contentLength));
  if (media.etag) response.setHeader('ETag', media.etag);
  if (media.lastModified) response.setHeader('Last-Modified', media.lastModified.toUTCString());
  if (media.desktopCacheEligible) {
    response.setHeader('X-SekerEagle-Desktop-Cache', 'public-derived-v1');
  }
}
