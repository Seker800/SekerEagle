import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { WORKSPACE_CHANGE_KINDS, type WorkspaceChanges } from '@sekereagle/library-core';
import { AccessAuthGuard } from './auth/access-auth.guard';
import { BrowserPrincipalGuard } from './auth/browser-principal.guard';
import { CurrentPrincipal } from './auth/current-principal.decorator';
import type { AuthPrincipal } from './auth/auth.types';
import { WorkspaceChangesService } from './workspace-changes.service';

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
export class WorkspaceChangesResponseDto implements WorkspaceChanges {
  @ApiProperty() epoch!: string;
  @ApiProperty({ type: WorkspaceChangeScopeDto }) scopes!: WorkspaceChangeScopeDto;
}
@ApiTags('library')
@Controller('library/changes')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class WorkspaceChangesController {
  constructor(private readonly changes: WorkspaceChangesService) {}
  @Get()
  @ApiOkResponse({ type: WorkspaceChangesResponseDto })
  snapshot(@CurrentPrincipal() principal: AuthPrincipal): WorkspaceChangesResponseDto {
    try {
      return this.changes.snapshot(principal.sub, principal.canViewPrivate);
    } catch {
      throw new ServiceUnavailableException('自动更新暂时不可用，现有结果已保留。');
    }
  }
}
