import { CAMERA_MAX_VIDEO_BYTES } from '@sekereagle/library-core';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InitiateEagleUploadDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  mimeType!: string;

  @ApiProperty({ minimum: 1, maximum: CAMERA_MAX_VIDEO_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CAMERA_MAX_VIDEO_BYTES)
  size!: number;

  @ApiPropertyOptional({ pattern: '^[a-fA-F0-9]{64}$' })
  @IsOptional()
  @Matches(/^[a-fA-F0-9]{64}$/)
  contentSha256?: string;

  @ApiPropertyOptional({ enum: ['SKIP', 'CREATE_COPY'], default: 'SKIP' })
  @IsOptional()
  @IsIn(['SKIP', 'CREATE_COPY'])
  duplicatePolicy?: 'SKIP' | 'CREATE_COPY';
}

export class CompleteUploadPartDto {
  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber!: number;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  etag!: string;
}

export class CompleteEagleUploadDto {
  @ApiProperty({ type: [CompleteUploadPartDto], maxItems: 10000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadPartDto)
  parts!: CompleteUploadPartDto[];
}
