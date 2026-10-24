import { Controller, Get, Query, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from '../eagle/library-mode';
import { PhotoStatisticsQueryDto } from './photo-statistics.dto';
import { PhotoStatisticsService } from './photo-statistics.service';

@ApiTags('photo-statistics')
@SetMetadata(LIBRARY_MODE, 'PHOTO')
@Controller('photos/photography/statistics')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class PhotoStatisticsController {
  constructor(private readonly statistics: PhotoStatisticsService) {}
  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: PhotoStatisticsQueryDto) {
    return this.statistics.get(principal.sub, principal.canViewPrivate, query);
  }
}
