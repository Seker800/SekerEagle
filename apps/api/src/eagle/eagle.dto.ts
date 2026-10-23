import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsArray,
  IsInt,
  IsISO8601,
  IsIn,
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
  ValidateNested,
} from 'class-validator';

import type { EagleAssetSort } from './eagle-asset-order';

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function optionalTrimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() || undefined : value;
}

export class AssetTimelineDayResponseDto {
  @ApiProperty() date!: string;
  @ApiProperty() before!: string;
  @ApiProperty() count!: number;
  @ApiProperty() offset!: number;
}
export class AssetTimelineResponseDto {
  @ApiProperty({ type: [AssetTimelineDayResponseDto] }) days!: AssetTimelineDayResponseDto[];
  @ApiProperty() total!: number;
}

export class AssetTimelineDto {
  @ApiPropertyOptional({ enum: ['CAPTURED_AT', 'ADDED_AT'] })
  @IsOptional()
  @IsIn(['CAPTURED_AT', 'ADDED_AT'])
  sort?: EagleAssetSort;
  @ApiPropertyOptional({ default: 'UTC' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timeZone = 'UTC';
}

export class ListEagleAssetsDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10000000,
    description:
      'Initial navigation offset within the selected date boundary; incompatible with cursor and search.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000000)
  offset?: number;

  @ApiPropertyOptional({
    description:
      'Exclusive date boundary for native timeline navigation; not combinable with search or cursor.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  before?: string;

  @ApiPropertyOptional({
    enum: ['CAPTURED_AT', 'ADDED_AT'],
    description:
      'Newest first. Missing capture time falls back to import time. Omitted preserves mode defaults and search relevance.',
  })
  @IsOptional()
  @IsIn(['CAPTURED_AT', 'ADDED_AT'])
  sort?: EagleAssetSort;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4') personId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) cameraModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) lensModel?: string;
  @ApiPropertyOptional({ enum: ['WITH', 'WITHOUT'] })
  @IsOptional()
  @IsIn(['WITH', 'WITHOUT'])
  gps?: 'WITH' | 'WITHOUT';
  @ApiPropertyOptional({ type: Number, maximum: 100, default: 30 })
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

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5 })
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

  @ApiPropertyOptional({ type: String, description: 'Comma-separated values' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : undefined,
  )
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[];

  @ApiPropertyOptional({ type: String, description: 'Comma-separated values' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : undefined,
  )
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  manualTagIds?: string[];

  @ApiPropertyOptional({ type: String, description: 'Comma-separated values' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : undefined,
  )
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  aiTagIds?: string[];

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsUUID('4')
  smartFolderId?: string;
  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  minWidth?: number;
  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  maxWidth?: number;
  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  minHeight?: number;
  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  maxHeight?: number;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  createdFrom?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  createdTo?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string;
  @ApiPropertyOptional({ enum: ['ANY', 'ALL'] })
  @IsOptional()
  @IsIn(['ANY', 'ALL'])
  tagMatch?: 'ANY' | 'ALL';
  @ApiPropertyOptional({ enum: ['PRIVATE'] })
  @IsOptional()
  @IsIn(['PRIVATE'])
  privacy?: 'PRIVATE';

  @ApiPropertyOptional({ description: 'JSON encoded Eagle filter query', maxLength: 12000 })
  @Transform(({ value }: { value: unknown }) => optionalTrimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  rules?: string;
}

export class CountEagleAssetsDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  query!: Record<string, unknown>;
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

export class SendEagleAssetsDto extends EagleAssetIdsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  operationId!: string;
}

export class ListEagleAssetUpdatesDto {
  @Transform(({ value }: { value: unknown }) => String(value).split(',').filter(Boolean))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class EagleAssetVersionDto {
  @IsUUID('4') assetId!: string;
  @Type(() => Number) @IsInt() @Min(1) rowVersion!: number;
}

export class BatchUpdateEagleAssetsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((asset: EagleAssetVersionDto) => asset.assetId)
  @ValidateNested({ each: true })
  @Type(() => EagleAssetVersionDto)
  assets!: EagleAssetVersionDto[];
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) displayName?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  sourceUrl?: string | null;
}

export class EaglePrivacySettingsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tagIds!: string[];
}

export class UpdateEaglePrivacySettingsDto extends EaglePrivacySettingsDto {
  @ApiProperty({
    type: [String],
    maxItems: 1000,
    description: '打开编辑器时读取的私密标签快照；变化时返回 409。',
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  expectedTagIds!: string[];
}

export class BatchChangeEagleManualTagsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assetIds!: string[];
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  addTagIds!: string[];
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  removeTagIds!: string[];
  @ApiPropertyOptional({ description: '清除所选素材的全部人工标签，不影响 AI 标签。' })
  @IsOptional()
  @IsBoolean()
  clearAll?: boolean;
}

export class ReplaceAssetTagsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  tagIds!: string[];
}

export class CreateManualTagDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @ApiPropertyOptional({ nullable: true, pattern: COLOR_PATTERN.source })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string | null;
}

export class UpdateManualTagDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsUUID('4') groupId?: string | null;
  @IsOptional() @IsBoolean() isStarred?: boolean;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;
}

export class CreateManualTagGroupDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
}

export class UpdateManualTagGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @Matches(COLOR_PATTERN) color?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsInt() @Min(1) rowVersion!: number;
}

export class CreateSmartFolderDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
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

export class UpdateSmartFolderDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: COLOR_PATTERN.source })
  @IsOptional()
  @Matches(COLOR_PATTERN)
  color?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  query?: Record<string, unknown>;

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
