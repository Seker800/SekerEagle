import type { LibraryMode } from '@prisma/client';
import { EagleOperationSummaryResponseDto } from './eagle-operation-response.dto';
import { ApiAcceptedResponse } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
  Optional,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { IsIn, IsBoolean, IsInt, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  TASK_FAMILIES,
  CONTROLLABLE_TASK_FAMILIES,
  type TaskFamily,
} from '@sekereagle/library-core';
import { AccessAuthGuard } from '../auth/access-auth.guard';
import { BrowserPrincipalGuard } from '../auth/browser-principal.guard';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleProcessingService } from './eagle-processing.service';
import { UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

export class RetryTaskFamilyDto {
  @ApiProperty({ enum: [...TASK_FAMILIES] })
  @IsIn(TASK_FAMILIES)
  family!: TaskFamily;
}
export class TaskEventsQueryDto {
  @ApiProperty({ enum: [...TASK_FAMILIES] })
  @IsIn(TASK_FAMILIES)
  family!: TaskFamily;
}
export class StartTaskFamilyDto {
  @ApiProperty({ enum: ['FACES'] })
  @IsIn(['FACES'])
  family!: TaskFamily;
}
export class TaskPolicyDto {
  @ApiProperty({ enum: [...CONTROLLABLE_TASK_FAMILIES] })
  @IsIn(CONTROLLABLE_TASK_FAMILIES)
  family!: TaskFamily;
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  paused!: boolean;
  @ApiProperty({ type: Number, minimum: 0, maximum: 1, required: false, deprecated: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  priority?: number;
}

@Controller('eagle/tasks')
@UseGuards(AccessAuthGuard, BrowserPrincipalGuard)
export class EagleTaskCenterController {
  constructor(
    private readonly tasks: EagleTaskCenterService,
    private readonly processing: EagleProcessingService,
    @Optional() private readonly operations: EagleAssetOperationService | undefined,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}
  @Get()
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tasks.overview(
      principal.sub,
      principal.canViewPrivate,
      'ACTIVE',
      principal.role === 'ADMIN',
    );
  }
  @Get('history')
  history(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tasks.overview(principal.sub, principal.canViewPrivate, 'HISTORY');
  }
  @Get('events')
  events(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: TaskEventsQueryDto) {
    return this.tasks.events(principal.sub, query.family, principal.canViewPrivate);
  }
  @Patch('policy')
  @UseGuards(BrowserOriginGuard)
  policy(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: TaskPolicyDto) {
    return this.tasks.policy(principal.sub, input);
  }
  @Post('start')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @UseGuards(BrowserOriginGuard)
  start(@CurrentPrincipal() principal: AuthPrincipal, @Body() _input: StartTaskFamilyDto) {
    if (this.libraryMode !== 'PHOTO' || _input.family !== 'FACES')
      throw new NotFoundException('没有可启动的扫描任务。');
    if (!this.operations) throw new Error('Task operation queue is unavailable');
    return this.operations.enqueueCommand(principal, { type: 'PHOTO_PEOPLE_SCAN', payload: {} });
  }
  @Post('retry')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: EagleOperationSummaryResponseDto })
  @UseGuards(BrowserOriginGuard)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RetryTaskFamilyDto) {
    if (!this.operations) throw new Error('Task operation queue is unavailable');
    return this.operations.enqueueCommand(principal, {
      type: 'TASK_FAMILY_RETRY',
      payload: { family: input.family },
    });
  }
  @Patch('settings')
  @UseGuards(BrowserOriginGuard)
  settings(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() input: UpdateEagleProcessingSettingsDto,
  ) {
    return this.processing.updateSettings(principal.sub, input);
  }
}
