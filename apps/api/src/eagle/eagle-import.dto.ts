import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateEagleImportRunDto {
  @IsString() @MinLength(1) @MaxLength(128) idempotencyKey!: string;
  @Type(() => Number) @IsInt() @Min(2) @Max(2) manifestVersion!: number;
  @IsString() @MinLength(1) @MaxLength(255) externalLibraryId!: string;
  @IsString() @MinLength(1) @MaxLength(255) libraryName!: string;
  @IsOptional() @Type(() => Date) @IsDate() sourceModifiedAt!: Date | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) declaredItemCount!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) declaredByteSize!: number;
}

export class EagleImportFolderDto {
  @IsString() @MinLength(1) @MaxLength(255) sourceId!: string;
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(255) parentSourceId!: string | null;
}

export class EagleImportTagDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
  @IsOptional() @IsBoolean() isStarred?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) groupSourceIds?: string[];
}

export class EagleImportTagGroupDto {
  @IsString() @MinLength(1) @MaxLength(255) sourceId!: string;
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsOptional() @IsString() @MaxLength(32) color?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
}

export class EagleImportItemDto {
  @IsString() @MinLength(1) @MaxLength(255) sourceItemId!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsString() @MinLength(1) @MaxLength(255) originalFileName!: string;
  @IsString() @MinLength(1) @MaxLength(16) extension!: string;
  @IsString() @MinLength(1) @MaxLength(100) mimeType!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) size!: number;
  @Type(() => Number) @IsInt() @Min(0) importedAt!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) modifiedAt!: number | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(5) star!: number;
  @IsString() @MaxLength(10_000) annotation!: string;
  @IsString() @MaxLength(2_048) sourceUrl!: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) tagNames!: string[];
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) folderIds!: string[];
  @IsBoolean() isDeleted!: boolean;
  @IsOptional() @Matches(/^[0-9a-f]{64}$/) contentSha256?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sourceFileModifiedAt?: number;
}

export class EagleImportManifestChunkDto {
  @Type(() => Number) @IsInt() @Min(2) @Max(2) manifestVersion!: number;
  @IsString() @MinLength(1) @MaxLength(128) chunkKey!: string;
  @Type(() => EagleImportFolderDto)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(2_000)
  folders!: EagleImportFolderDto[];
  @Type(() => EagleImportTagDto)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(2_000)
  tags!: EagleImportTagDto[];
  @Type(() => EagleImportTagGroupDto)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(500)
  tagGroups!: EagleImportTagGroupDto[];
  @Type(() => EagleImportItemDto)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(500)
  items!: EagleImportItemDto[];
}

export class ListEagleImportItemsDto {
  @ApiPropertyOptional({ maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) status?: string;
}

export class ListEagleImportRunsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) externalLibraryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) status?: string;
  @ApiPropertyOptional({ maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) cursor?: string;
}

export class FinishEagleImportItemDto {
  @ApiProperty() @IsString() @Matches(/^[0-9a-f-]{36}$/i) assetId!: string;
}
