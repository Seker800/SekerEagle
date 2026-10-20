import { safeMediaResponse } from '../common/media-response';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  SetMetadata,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { RequirePatScopes } from '../auth/required-scopes';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { EagleMediaService } from '../eagle/eagle-media.service';
import { LIBRARY_MODE } from '../eagle/library-mode';
import { PhotoAgentService } from './photo-agent.service';
import {
  CreatePhotoTaskDto,
  InferPhotoCitiesDto,
  PhotoAgentQueryDto,
  ProposePhotoDto,
  ReviewPhotoSuggestionDto,
  ScorePhotoCandidatesDto,
} from './photo-agent.dto';
@ApiTags('photo-agent')
@SetMetadata(LIBRARY_MODE, 'PHOTO')
@Controller('photos/agent')
@UseGuards(AccessAuthGuard, PatScopeGuard)
@RequirePatScopes('photo:read')
export class PhotoAgentController {
  constructor(
    private readonly agent: PhotoAgentService,
    private readonly media: EagleMediaService,
  ) {}
  @Get('photos') photos(@CurrentPrincipal() p: AuthPrincipal, @Query() q: PhotoAgentQueryDto) {
    return this.agent.photos(p.sub, q, p.canViewPrivate);
  }
  @Get('photos/:id/preview') async preview(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rendition = await this.agent.preview(p.sub, id, p.canViewPrivate);
    const media = await this.media.getRendition(p.sub, id, rendition, undefined, p.canViewPrivate);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(media.stream!, safeMediaResponse(media.mimeType, media.fileName));
  }
  @Get('tasks') tasks(@CurrentPrincipal() p: AuthPrincipal, @Query() q: PhotoAgentQueryDto) {
    return this.agent.tasks(p.sub, q, p.canViewPrivate);
  }
  @Post('tasks') @RequirePatScopes('photo:read', 'photo:suggest') create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body() dto: CreatePhotoTaskDto,
  ) {
    return this.agent.createTask(p.sub, dto, p.canViewPrivate);
  }
  @Get('tasks/:id') detail(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agent.detail(p.sub, id, p.canViewPrivate);
  }
  @Post('tasks/:id/infer-cities') @RequirePatScopes('photo:read', 'photo:suggest') infer(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: InferPhotoCitiesDto,
  ) {
    return this.agent.infer(p.sub, id, dto, p.canViewPrivate);
  }
  @Post('tasks/:id/scores') @RequirePatScopes('photo:read', 'photo:suggest') scores(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ScorePhotoCandidatesDto,
  ) {
    return this.agent.scores(p.sub, id, dto.description, p.canViewPrivate);
  }
  @Post('tasks/:id/suggestions') @RequirePatScopes('photo:read', 'photo:suggest') propose(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ProposePhotoDto,
  ) {
    return this.agent.propose(p.sub, id, dto, p.canViewPrivate);
  }
  @Post('tasks/:id/cancel') @UseGuards(BrowserPrincipalGuard, BrowserOriginGuard) cancel(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.agent.cancel(p.sub, id, p.canViewPrivate);
  }
  @Post('tasks/:id/suggestions/:suggestionId/review')
  @UseGuards(BrowserPrincipalGuard, BrowserOriginGuard)
  review(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('suggestionId', new ParseUUIDPipe({ version: '4' })) suggestionId: string,
    @Body() dto: ReviewPhotoSuggestionDto,
  ) {
    return this.agent.review(p.sub, id, suggestionId, dto, p.canViewPrivate);
  }
  @Post('tasks/:id/suggestions/:suggestionId/undo')
  @UseGuards(BrowserPrincipalGuard, BrowserOriginGuard)
  undo(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('suggestionId', new ParseUUIDPipe({ version: '4' })) suggestionId: string,
  ) {
    return this.agent.undo(p.sub, id, suggestionId, p.canViewPrivate);
  }
}
