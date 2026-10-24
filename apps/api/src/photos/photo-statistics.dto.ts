import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

function CalendarDate() {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'calendarDate',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (value: string) =>
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
          new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
      },
    });
}
export class PhotoStatisticsQueryDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month', 'year'], default: 'month' })
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  grain?: 'day' | 'week' | 'month' | 'year';
  @ApiPropertyOptional({ enum: ['total', 'camera', 'lens'], default: 'camera' })
  @IsOptional()
  @IsIn(['total', 'camera', 'lens'])
  groupBy?: 'total' | 'camera' | 'lens';
  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @CalendarDate()
  start?: string;
  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @CalendarDate()
  end?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? (value as unknown[]) : [value],
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  cameras?: string[];
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? (value as unknown[]) : [value],
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  lenses?: string[];
}
