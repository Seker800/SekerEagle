import { Controller, Get, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { WORKSPACE_CHANGE_KINDS, type WorkspaceChanges } from '@sekereagle/library-core';
import { AccessAuthGuard } from './auth/access-auth.guard';
import { BrowserPrincipalGuard } from './auth/browser-principal.guard';
import { CurrentPrincipal } from './auth/current-principal.decorator';
import type { AuthPrincipal } from './auth/auth.types';
import { WorkspaceChangesService } from './workspace-changes.service';
import { PrivacyVisibilityService } from './auth/privacy-visibility.service';

class WorkspaceChangeScopeDto {
  @ApiProperty({
    type: 'object',
    required: [...WORKSPACE_CHANGE_KINDS],
    additionalProperties: { type: 'string' },
  })
  MATERIAL!: WorkspaceChanges['scopes']['MATERIAL'];
  @ApiProperty({
    type: 'object',
    required: [...WORKSPACE_CHANGE_KINDS],
    additionalProperties: { type: 'string' },
  })
  PHOTO!: WorkspaceChanges['scopes']['PHOTO'];
}
class WorkspaceHealthDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE'] }) worker!: 'ONLINE' | 'OFFLINE';
  @ApiProperty({ enum: ['READY', 'UNKNOWN', 'OFFLINE', 'DRIFTED'] }) embedding!:
    'READY' | 'UNKNOWN' | 'OFFLINE' | 'DRIFTED';
}
export class WorkspaceChangesResponseDto implements WorkspaceChanges {
  @ApiProperty({ type: WorkspaceHealthDto, required: false }) health?: WorkspaceHealthDto;
  @ApiProperty() epoch!: string;
  @ApiProperty({ type: WorkspaceChangeScopeDto }) scopes!: WorkspaceChangeScopeDto;
}
@ApiTags('library')
@Controller('library/changes')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class WorkspaceChangesController {
  constructor(
    private readonly changes: WorkspaceChangesService,
    private readonly privacy: PrivacyVisibilityService,
  ) {}
  @Get()
  @ApiOkResponse({ type: WorkspaceChangesResponseDto })
  async snapshot(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Req() request: Request,
  ): Promise<WorkspaceChangesResponseDto> {
    try {
      const [material, photo] = await Promise.all([
        this.privacy.readGrant(principal.sub, request, 'MATERIAL'),
        this.privacy.readGrant(principal.sub, request, 'PHOTO'),
      ]);
      return await this.changes.snapshot(principal.sub, {
        MATERIAL: material !== null,
        PHOTO: photo !== null,
      });
    } catch {
      throw new ServiceUnavailableException('自动更新暂时不可用，现有结果已保留。');
    }
  }
}
