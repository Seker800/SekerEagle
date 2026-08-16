import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsInt,
  IsObject,
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

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function optionalTrimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() || undefined : value;
}

export class ListEagleAssetsDto {
  @ApiPropertyOptional({ maximum: 100, default: 30 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) => optionalTrimmed(value))
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => optionalTrimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 32 })
  @Transform(({ value }: { value: unknown }) => optionalTrimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(32)
  format?: string;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.split(',').filter(Boolean) : undefined)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[];

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.split(',').filter(Boolean) : undefined)
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  manualTagIds?: string[];

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.split(',').filter(Boolean) : undefined)
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  aiTagIds?: string[];

  @IsOptional() @IsUUID('4') smartFolderId?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) minWidth?: number;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) maxWidth?: number;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) minHeight?: number;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) maxHeight?: number;
  @IsOptional() @IsString() createdFrom?: string;
  @IsOptional() @IsString() createdTo?: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string;
}

export class UpdateEagleAssetDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;

  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ nullable: true, pattern: COLOR_PATTERN.source })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  sourceUrl?: string | null;
}

export class EagleAssetIdsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class ReplaceAssetTagsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  tagIds!: string[];
}

export class CreateManualTagDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ nullable: true, pattern: COLOR_PATTERN.source })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string | null;
}

export class UpdateManualTagDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsUUID('4') groupId?: string | null;
  @IsOptional() @IsBoolean() isStarred?: boolean;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;
}

export class CreateManualTagGroupDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
}

export class UpdateManualTagGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsInt() @Min(1) rowVersion!: number;
}

export class CreateSmartFolderDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: COLOR_PATTERN.source })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  query!: Record<string, unknown>;
}

export class UpdateSmartFolderDto extends CreateSmartFolderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;
}

export class MoveSmartFolderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  position!: number;
}
