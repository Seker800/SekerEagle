import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, Matches } from 'class-validator';

export class UpdateEagleAiTagSettingsDto {
  @ApiProperty({ example: false })
  @IsBoolean() manualEnabled!: boolean;

  @ApiProperty({ example: false })
  @IsBoolean() scheduleEnabled!: boolean;

  @ApiProperty({ example: '23:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) scheduleStart!: string;

  @ApiProperty({ example: '06:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) scheduleEnd!: string;
}
