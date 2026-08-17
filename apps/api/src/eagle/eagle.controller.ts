import {
  Body,
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
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  isObjectRangeNotSatisfiableError,
  parseRangeHeader,
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
  UpdateSmartFolderDto,
} from './eagle.dto';
import { EagleService } from './eagle.service';
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
  ) {}

  @Get('media-capabilities')
  getMediaCapabilities() {
    return this.mediaCapabilities.getCapabilities();
  }

  @Get('assets')
  listAssets(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListEagleAssetsDto) {
    return this.eagle.listAssets(principal.sub, query);
  }

  @Get('asset-updates')
  listAssetUpdates(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListEagleAssetUpdatesDto,
  ) {
    return this.eagle.listUpdates(principal.sub, query.assetIds);
  }

  @Post('asset-updates')
  @UseGuards(BrowserOriginGuard)
  listAssetUpdatesByBody(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: EagleAssetIdsDto,
  ) {
    return this.eagle.listUpdates(principal.sub, input.assetIds);
  }

  @Get('assets/:assetId')
  getAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.eagle.getAsset(principal.sub, assetId);
  }

  @Get('trash/:assetId')
  getTrashAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.eagle.getAsset(principal.sub, assetId, true);
  }

  @Get('assets/:assetId/original')
  async getOriginal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Headers('range') range: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    let parsedRange: string | undefined;
    try {
      parsedRange = parseRangeHeader(range);
    } catch {
      const metadata = await this.media.getOriginalMetadata(principal.sub, assetId);
      setRangeNotSatisfiableHeaders(response, metadata.size);
      return;
    }
    let media: Awaited<ReturnType<EagleMediaService['getOriginal']>>;
    try {
      media = await this.media.getOriginal(principal.sub, assetId, parsedRange, ifNoneMatch);
    } catch (error) {
      if (!isObjectRangeNotSatisfiableError(error)) throw error;
      const metadata = await this.media.getOriginalMetadata(principal.sub, assetId);
      setRangeNotSatisfiableHeaders(response, metadata.size);
      return;
    }
    applyMediaHeaders(response, media, 'private, max-age=3600');
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
    response.once('close', () => {
      if (!response.writableEnded && !media.stream!.destroyed) media.stream!.destroy();
    });
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

  @Get('assets/:assetId/renditions/:renditionId')
  async getRendition(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Param('renditionId', new ParseUUIDPipe({ version: '4' })) renditionId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const media = await this.media.getRendition(principal.sub, assetId, renditionId, ifNoneMatch);
    applyMediaHeaders(response, media, 'private, max-age=31536000, immutable');
    if (media.notModified) {
      response.status(304);
      return;
    }
    return new StreamableFile(media.stream!);
  }

  @Get('assets/:assetId/renditions/:renditionId/content')
  getRenditionContent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Param('renditionId', new ParseUUIDPipe({ version: '4' })) renditionId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getRendition(principal, assetId, renditionId, ifNoneMatch, response);
  }

  @Get('assets/:assetId/pyramid')
  getPyramidDescriptor(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
  ) {
    return this.media.getPyramidDescriptor(principal.sub, assetId);
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
    const media = await this.media.getPyramidTile(
      principal.sub,
      assetId,
      pyramidId,
      level,
      x,
      y,
      ifNoneMatch,
    );
    applyMediaHeaders(response, media, 'private, max-age=31536000, immutable');
    if (media.notModified) {
      response.status(304);
      return;
    }
    return new StreamableFile(media.stream!);
  }

  @Patch('assets/batch')
  @UseGuards(BrowserOriginGuard)
  batchUpdate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchUpdateEagleAssetsDto,
  ) {
    return this.eagle.batchUpdate(principal.sub, input);
  }

  @Patch('assets/:assetId')
  @UseGuards(BrowserOriginGuard)
  updateAsset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: UpdateEagleAssetDto,
  ) {
    return this.eagle.updateAsset(principal.sub, assetId, input);
  }

  @Post('assets/trash')
  @UseGuards(BrowserOriginGuard)
  trashAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.eagle.setTrash(principal.sub, input.assetIds, false);
  }

  @Post('assets/batch/trash')
  @UseGuards(BrowserOriginGuard)
  batchTrash(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.eagle.setTrash(principal.sub, input.assetIds, false);
  }

  @Post('assets/batch/restore')
  @UseGuards(BrowserOriginGuard)
  batchRestore(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.eagle.setTrash(principal.sub, input.assetIds, true);
  }

  @Get('trash')
  listTrash(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListEagleAssetsDto) {
    return this.eagle.listAssets(principal.sub, query, true);
  }

  @Post('trash/restore')
  @UseGuards(BrowserOriginGuard)
  restoreAssets(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: EagleAssetIdsDto) {
    return this.eagle.setTrash(principal.sub, input.assetIds, true);
  }

  @Delete('trash')
  @UseGuards(BrowserOriginGuard)
  emptyTrash(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.emptyTrash(principal.sub);
  }

  @Post('trash/empty')
  @UseGuards(BrowserOriginGuard)
  emptyTrashCompat(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.emptyTrash(principal.sub);
  }

  @Get(['tags', 'manual-tags'])
  listTags(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listManualTags(principal.sub);
  }

  @Post(['tags', 'manual-tags'])
  @UseGuards(BrowserOriginGuard)
  createTag(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateManualTagDto) {
    return this.eagle.createManualTag(principal.sub, input);
  }

  @Patch(['tags/:tagId', 'manual-tags/:tagId'])
  @UseGuards(BrowserOriginGuard)
  updateTag(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
    @Body() input: UpdateManualTagDto,
  ) {
    return this.eagle.updateManualTag(principal.sub, tagId, input);
  }

  @Delete(['tags/:tagId', 'manual-tags/:tagId'])
  @UseGuards(BrowserOriginGuard)
  deleteTag(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
  ) {
    return this.eagle.deleteManualTag(principal.sub, tagId);
  }

  @Get(['tag-groups', 'manual-tag-groups'])
  listTagGroups(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listManualTagGroups(principal.sub);
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
  deleteTagGroup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
  ) {
    return this.eagle.deleteManualTagGroup(principal.sub, groupId);
  }

  @Get('ai-tags')
  listAiTags(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.eagle.listAiTags(principal.sub);
  }

  @Put('assets/:assetId/tags')
  @UseGuards(BrowserOriginGuard)
  replaceAssetTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: ReplaceAssetTagsDto,
  ) {
    return this.eagle.replaceAssetTags(principal.sub, assetId, input.tagIds);
  }

  @Put('assets/:assetId/manual-tags')
  @UseGuards(BrowserOriginGuard)
  replaceAssetManualTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('assetId', new ParseUUIDPipe({ version: '4' })) assetId: string,
    @Body() input: ReplaceAssetTagsDto,
  ) {
    return this.eagle.replaceAssetTags(principal.sub, assetId, input.tagIds);
  }

  @Post('assets/batch/manual-tags')
  @UseGuards(BrowserOriginGuard)
  batchChangeManualTags(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchChangeEagleManualTagsDto,
  ) {
    return this.eagle.batchChangeManualTags(principal.sub, input);
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

function applyMediaHeaders(
  response: Response,
  media: {
    fileName: string;
    mimeType: string;
    contentLength?: number;
    etag?: string;
    lastModified?: Date;
  },
  cacheControl: string,
): void {
  response.setHeader('Content-Type', media.mimeType);
  response.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
  );
  response.setHeader('Cache-Control', cacheControl);
  response.vary('Authorization');
  if (media.contentLength !== undefined)
    response.setHeader('Content-Length', String(media.contentLength));
  if (media.etag) response.setHeader('ETag', media.etag);
  if (media.lastModified) response.setHeader('Last-Modified', media.lastModified.toUTCString());
}
