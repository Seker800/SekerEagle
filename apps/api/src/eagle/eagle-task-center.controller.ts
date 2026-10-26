import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
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
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleProcessingService } from './eagle-processing.service';
import { UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

export class RetryTaskFamilyDto {
  @ApiProperty({ enum: [...TASK_FAMILIES] })
  @IsIn(TASK_FAMILIES)
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
  ) {}
  @Get()
  overview(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tasks.overview(principal.sub, principal.canViewPrivate);
  }
  @Get('history')
  history(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.tasks.overview(principal.sub, principal.canViewPrivate, 'HISTORY');
  }
  @Patch('policy')
  @UseGuards(BrowserOriginGuard)
  policy(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: TaskPolicyDto) {
    return this.tasks.policy(principal.sub, input);
  }
  @Post('retry')
  @UseGuards(BrowserOriginGuard)
  retry(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RetryTaskFamilyDto) {
    return this.tasks.retry(principal.sub, input.family, principal.canViewPrivate);
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
