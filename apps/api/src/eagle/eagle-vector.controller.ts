import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  BatchReviewVectorSuggestionsDto,
  ListTagDistanceAssetsDto,
  ListUnclassifiedVectorAssetsDto,
  ListVectorSuggestionsDto,
  ListVectorTagsDto,
  ReviewVectorSuggestionDto,
  SetTagRecommendationDto,
} from './eagle-vector.dto';
import { EagleVectorService } from './eagle-vector.service';

@Controller('eagle/vector')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class EagleVectorController {
  constructor(private readonly vectors: EagleVectorService) {}

  @Get('summary')
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.vectors.summary(principal.sub, principal.canViewPrivate);
  }

  @Get('tags')
  tags(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: ListVectorTagsDto) {
    return this.vectors.listTagSemantics(principal.sub, query.query, principal.canViewPrivate);
  }

  @Patch('tags/:tagId')
  @UseGuards(BrowserOriginGuard)
  setTagRecommendation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
    @Body() input: SetTagRecommendationDto,
  ) {
    return this.vectors.setRecommendationEnabled(principal.sub, tagId, input.recommendationEnabled);
  }

  @Post('tags/:tagId/rebuild')
  @UseGuards(BrowserOriginGuard)
  rebuildTag(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
  ) {
    return this.vectors.requestTagRebuild(principal.sub, tagId);
  }

  @Get('tags/:tagId/assets')
  tagAssets(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
    @Query() query: ListTagDistanceAssetsDto,
  ) {
    return this.vectors.listTagDistanceAssets(
      principal.sub,
      tagId,
      query,
      principal.canViewPrivate,
    );
  }

  @Get('suggestions')
  suggestions(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListVectorSuggestionsDto,
  ) {
    return this.vectors.listSuggestions(principal.sub, query, principal.canViewPrivate);
  }

  @Get('unclassified')
  unclassified(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListUnclassifiedVectorAssetsDto,
  ) {
    return this.vectors.listUnclassified(principal.sub, query, principal.canViewPrivate);
  }

  @Post('embeddings/retry-failed')
  @UseGuards(BrowserOriginGuard)
  retryFailedEmbeddings(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.vectors.retryFailedEmbeddings(principal.sub);
  }

  @Post('embeddings/scan-missing')
  @UseGuards(BrowserOriginGuard)
  scanMissingEmbeddings(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.vectors.scanMissingEmbeddings(principal.sub);
  }

  @Post('suggestions/scan-unclassified')
  @UseGuards(BrowserOriginGuard)
  scanUnclassifiedSuggestions(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.vectors.scanUnclassifiedSuggestions(principal.sub, principal.canViewPrivate);
  }

  @Post('suggestions/:suggestionId/review')
  @UseGuards(BrowserOriginGuard)
  review(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('suggestionId', new ParseUUIDPipe({ version: '4' })) suggestionId: string,
    @Body() input: ReviewVectorSuggestionDto,
  ) {
    return this.vectors.reviewSuggestion(
      principal.sub,
      suggestionId,
      input.action,
      principal.canViewPrivate,
    );
  }

  @Post('suggestions/review-batch')
  @UseGuards(BrowserOriginGuard)
  reviewBatch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: BatchReviewVectorSuggestionsDto,
  ) {
    return this.vectors.reviewSuggestions(
      principal.sub,
      input.suggestionIds,
      input.action,
      principal.canViewPrivate,
    );
  }
}
