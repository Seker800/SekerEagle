import { Body, Controller, Get, Param, Patch, Post, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiTags, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
import { PhotoManagementService } from './photo-management.service';
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
  constructor(private readonly photos: PhotoManagementService) {}
  @Get('timeline')
  timeline(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.timeline(p.sub, p.canViewPrivate);
  }
  @Get('facets')
  facets(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.facets(p.sub, p.canViewPrivate);
  }
  @Get('people') people(@CurrentPrincipal() p: AuthPrincipal) {
    return this.photos.people(p.sub, p.canViewPrivate);
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
