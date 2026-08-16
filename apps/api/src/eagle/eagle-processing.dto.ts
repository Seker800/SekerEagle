import { IsEnum, IsOptional, Matches } from 'class-validator';

export enum EagleProcessingModeDto { ALWAYS = 'ALWAYS', NIGHT = 'NIGHT', MANUAL = 'MANUAL' }

export class UpdateEagleProcessingSettingsDto {
  @IsEnum(EagleProcessingModeDto) mode!: EagleProcessingModeDto;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) nightStart!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) nightEnd!: string;
}

export class ListEagleProcessingJobsDto {
  @IsOptional() status?: string;
  @IsOptional() lane?: string;
  @IsOptional() kind?: string;
}
