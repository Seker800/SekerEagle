import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  SetMetadata,
  UseGuards,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  Min,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from '../eagle/library-mode';
import { PhotoMapService } from './photo-map.service';
import { MapViewportDto, MapPhotosDto } from './photo-map.dto';
import { PhotoManagementService } from './photo-management.service';
export class PeopleCursorDto {
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  after?: string;
}
export class PeopleQueryDto extends PeopleCursorDto {
  @ApiPropertyOptional({ enum: ['full', 'cards', 'options'] })
  @IsOptional()
  @IsIn(['full', 'cards', 'options'])
  view?: 'full' | 'cards' | 'options';
}
class PersonPrivacyDto {
  @ApiProperty() @IsBoolean() marksAssetsPrivate!: boolean;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) rowVersion!: number;
}
class RenamePersonDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) name!: string;
}
class MergePeopleDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') targetId!: string;
}
class ReassignFaceDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  personId?: string | null;
}
class GroupMembersDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  assetIds!: string[];
}
class UpdateGroupDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dismissed?: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') bestAssetId?: string;
}
@ApiTags('photo-management')
@SetMetadata(LIBRARY_MODE, 'PHOTO')
@Controller('photos/photography')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class PhotoManagementController {
  constructor(
    private readonly photos: PhotoManagementService,
    private readonly map: PhotoMapService,
  ) {}
  @Get('map')
  mapClusters(@CurrentPrincipal() p: AuthPrincipal, @Query() query: MapViewportDto) {
    return this.map.clusters(p.sub, p.canViewPrivate, query);
  }
  @Get('map/:cell/photos')
  mapPhotos(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('cell') cell: string,
    @Query() query: MapPhotosDto,
  ) {
    return this.map.photos(p.sub, p.canViewPrivate, cell, query.after);
  }
  @Get('timeline')
  timeline(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.timeline(p.sub, p.canViewPrivate);
  }
  @Get('facets')
  facets(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.facets(p.sub, p.canViewPrivate);
  }
  @Get('people') people(@CurrentPrincipal() p: AuthPrincipal, @Query() query: PeopleQueryDto) {
    return this.photos.people(p.sub, p.canViewPrivate, query.after, query.view);
  }
  @Get('people/:id/faces')
  personFaces(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PeopleCursorDto,
  ) {
    return this.photos.personFaces(p.sub, id, p.canViewPrivate, query.after);
  }
  @Get('people/review')
  reviewPeople(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.reviewPeople(p.sub, p.canViewPrivate);
  }
  @Post('people/scan') @UseGuards(BrowserOriginGuard) scanPeople(
    @CurrentPrincipal() p: AuthPrincipal,
  ) {
    return this.photos.scanFaces(p.sub, p.canViewPrivate);
  }
  @Patch('people/:id') @UseGuards(BrowserOriginGuard) rename(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: RenamePersonDto,
  ) {
    return this.photos.renamePerson(p.sub, id, dto.name, p.canViewPrivate);
  }
  @Patch('people/:id/privacy') @UseGuards(BrowserOriginGuard) privacy(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: PersonPrivacyDto,
  ) {
    return this.photos.setPersonPrivacy(
      p.sub,
      id,
      dto.marksAssetsPrivate,
      dto.rowVersion,
      p.canViewPrivate,
    );
  }
  @Post('people/:id/merge') @UseGuards(BrowserOriginGuard) merge(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: MergePeopleDto,
  ) {
    return this.photos.mergePeople(p.sub, id, dto.targetId, p.canViewPrivate);
  }
  @Patch('faces/:id/person') @UseGuards(BrowserOriginGuard) assign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: ReassignFaceDto,
  ) {
    return this.photos.reassignFace(p.sub, id, dto.personId ?? null, p.canViewPrivate);
  }
  @Get('groups') groups(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.groups(p.sub, p.canViewPrivate);
  }
  @Post('groups/scan') @UseGuards(BrowserOriginGuard) scanGroups(
    @CurrentPrincipal() p: AuthPrincipal,
  ) {
    return this.photos.scanGroups(p.sub, p.canViewPrivate);
  }
  @Post('groups/manual')
  @UseGuards(BrowserOriginGuard)
  createGroup(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: GroupMembersDto) {
    return this.photos.createGroup(p.sub, dto.assetIds, p.canViewPrivate);
  }
  @Patch('groups/:id/members')
  @UseGuards(BrowserOriginGuard)
  removeMembers(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: GroupMembersDto,
  ) {
    return this.photos.removeGroupMembers(p.sub, id, dto.assetIds, p.canViewPrivate);
  }
  @Post('groups/:id/merge')
  @UseGuards(BrowserOriginGuard)
  mergeGroups(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: MergePeopleDto,
  ) {
    return this.photos.mergeGroups(p.sub, id, dto.targetId, p.canViewPrivate);
  }
  @Patch('groups/:id') @UseGuards(BrowserOriginGuard) group(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.photos.updateGroup(p.sub, id, dto, p.canViewPrivate);
  }
}
