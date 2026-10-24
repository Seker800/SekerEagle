import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EagleMediaJobKind, EagleMediaJobStatus, EagleProcessingLane } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export enum EagleProcessingModeDto {
  ALWAYS = 'ALWAYS',
  NIGHT = 'NIGHT',
  MANUAL = 'MANUAL',
}

export class UpdateEagleProcessingSettingsDto {
  @ApiProperty({ enum: EagleProcessingModeDto })
  @IsEnum(EagleProcessingModeDto)
  mode!: EagleProcessingModeDto;
  @ApiProperty({ type: String, example: '23:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  nightStart!: string;
  @ApiProperty({ type: String, example: '06:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  nightEnd!: string;
}

export class ListEagleProcessingJobsDto {
  @IsOptional() @IsEnum(EagleMediaJobStatus) status?: EagleMediaJobStatus;
  @IsOptional() @IsEnum(EagleProcessingLane) lane?: EagleProcessingLane;
  @IsOptional() @IsEnum(EagleMediaJobKind) kind?: EagleMediaJobKind;
  @IsOptional() @IsString() @MaxLength(1024) cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}
