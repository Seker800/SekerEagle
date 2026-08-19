import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InitiateEagleBrowserCaptureDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  clientCaptureId!: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  mimeType!: string;

  @ApiProperty({ minimum: 1, maximum: 100 * 1024 * 1024 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  size!: number;

  @ApiPropertyOptional({ pattern: '^[a-fA-F0-9]{64}$' })
  @IsOptional()
  @Matches(/^[a-fA-F0-9]{64}$/)
  contentSha256?: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  pageTitle!: string;

  @ApiProperty({ maxLength: 2048 })
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  pageUrl!: string;

  @ApiPropertyOptional({ maxLength: 4096 })
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(4096)
  imageUrl?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  altText?: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  capturedAt!: string;

  @ApiProperty({ minLength: 1, maxLength: 64, pattern: '^[0-9A-Za-z._+-]+$' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[0-9A-Za-z._+-]+$/)
  extensionVersion!: string;
}
