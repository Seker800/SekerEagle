import {
  Body,
  HttpCode,
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
import { Type } from 'class-transformer';
import { ApiTags, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ValidateNested,
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
import { EagleAssetOperationService } from '../eagle/eagle-asset-operations.service';
import { libraryCommandPayload } from '../eagle/eagle-library-command';
import { LIBRARY_MODE } from '../eagle/library-mode';
import { PhotoMapService } from './photo-map.service';
import { MapViewportDto, MapPhotosDto } from './photo-map.dto';
import { PhotoPersonReviewService } from './photo-person-review.service';
import { PhotoManagementService } from './photo-management.service';
export class PeopleCursorDto {
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  after?: string;
}
export class PeopleQueryDto extends PeopleCursorDto {
  @ApiPropertyOptional({ enum: ['ALL', 'NAMED', 'UNNAMED', 'full', 'cards', 'options'] })
  @IsOptional()
  @IsIn(['ALL', 'NAMED', 'UNNAMED', 'full', 'cards', 'options'])
  view?: 'ALL' | 'NAMED' | 'UNNAMED' | 'full' | 'cards' | 'options';
  @ApiPropertyOptional({ enum: ['full', 'cards', 'options'] })
  @IsOptional()
  @IsIn(['full', 'cards', 'options'])
  projection?: 'full' | 'cards' | 'options';
}
export class PersonReviewDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') firstId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') secondId!: string;
  @ApiProperty() @IsInt() @Min(1) firstVersion!: number;
  @ApiProperty() @IsInt() @Min(1) secondVersion!: number;
  @ApiProperty({ enum: ['SAME', 'DIFFERENT'] }) @IsIn(['SAME', 'DIFFERENT']) decision!:
    'SAME' | 'DIFFERENT';
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
export class PersonMergeMemberDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string;
  @ApiProperty() @IsInt() @Min(1) rowVersion!: number;
}
export class MergeSelectedPeopleDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') targetId!: string;
  @ApiProperty({ type: [PersonMergeMemberDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PersonMergeMemberDto)
  people!: PersonMergeMemberDto[];
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
    private readonly review: PhotoPersonReviewService,
    private readonly operations: EagleAssetOperationService,
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
    return this.photos.people(p.sub, p.canViewPrivate, query.after, query.view, query.projection);
  }
  @Get('people/:id/faces')
  personFaces(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PeopleCursorDto,
  ) {
    return this.photos.personFaces(p.sub, id, p.canViewPrivate, query.after);
  }
  @Get('people/summary') summary(@CurrentPrincipal() p: AuthPrincipal) {
    return this.review.summary(p.sub, p.canViewPrivate);
  }
  @Get('people/review') reviewPeople(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query() query: PeopleQueryDto,
  ) {
    return this.review.suggestions(p.sub, p.canViewPrivate, query.after);
  }
  @Post('people/review') @HttpCode(202) @UseGuards(BrowserOriginGuard) decidePeople(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body() dto: PersonReviewDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_PEOPLE_REVIEW',
      payload: libraryCommandPayload(dto),
    });
  }
  @Get('people/review-priority')
  async priorityPeople(@CurrentPrincipal() p: AuthPrincipal) {
    const result = await this.review.suggestions(p.sub, p.canViewPrivate);
    return { pairs: result.items };
  }
  @Post('people/scan') @HttpCode(202) @UseGuards(BrowserOriginGuard) scanPeople(
    @CurrentPrincipal() p: AuthPrincipal,
  ) {
    return this.operations.enqueueCommand(p, { type: 'PHOTO_PEOPLE_SCAN', payload: {} });
  }
  @Patch('people/:id') @HttpCode(202) @UseGuards(BrowserOriginGuard) rename(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: RenamePersonDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_PERSON_RENAME',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
  @Patch('people/:id/privacy') @HttpCode(202) @UseGuards(BrowserOriginGuard) privacy(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: PersonPrivacyDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_PERSON_PRIVACY',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
  @Post('people/merge-selected') @HttpCode(202) @UseGuards(BrowserOriginGuard) mergeSelected(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body() dto: MergeSelectedPeopleDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_PEOPLE_MERGE_SELECTED',
      payload: libraryCommandPayload(dto),
    });
  }
  @Post('people/:id/merge') @HttpCode(202) @UseGuards(BrowserOriginGuard) merge(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: MergePeopleDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_PEOPLE_MERGE',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
  @Patch('faces/:id/person') @HttpCode(202) @UseGuards(BrowserOriginGuard) assign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: ReassignFaceDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_FACE_REASSIGN',
      payload: libraryCommandPayload({ id, personId: dto.personId ?? null }),
    });
  }
  @Get('groups') groups(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.groups(p.sub, p.canViewPrivate);
  }
  @Post('groups/scan') @HttpCode(202) @UseGuards(BrowserOriginGuard) scanGroups(
    @CurrentPrincipal() p: AuthPrincipal,
  ) {
    return this.operations.enqueueCommand(p, { type: 'PHOTO_GROUPS_SCAN', payload: {} });
  }
  @Post('groups/manual')
  @HttpCode(202)
  @UseGuards(BrowserOriginGuard)
  createGroup(@CurrentPrincipal() p: AuthPrincipal, @Body() dto: GroupMembersDto) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_GROUP_CREATE',
      payload: libraryCommandPayload(dto),
    });
  }
  @Patch('groups/:id/members')
  @HttpCode(202)
  @UseGuards(BrowserOriginGuard)
  removeMembers(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: GroupMembersDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_GROUP_REMOVE_MEMBERS',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
  @Post('groups/:id/merge')
  @HttpCode(202)
  @UseGuards(BrowserOriginGuard)
  mergeGroups(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: MergePeopleDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_GROUP_MERGE',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
  @Patch('groups/:id') @HttpCode(202) @UseGuards(BrowserOriginGuard) group(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.operations.enqueueCommand(p, {
      type: 'PHOTO_GROUP_UPDATE',
      payload: libraryCommandPayload({ id, ...dto }),
    });
  }
}
