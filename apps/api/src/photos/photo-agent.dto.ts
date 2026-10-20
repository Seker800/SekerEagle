import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
export class CreatePhotoTaskDto {
  @ApiProperty({ enum: ['CITY', 'NON_PHOTO'] }) @IsIn(['CITY', 'NON_PHOTO']) kind!:
    'CITY' | 'NON_PHOTO';
  @ApiProperty({ type: [String], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}
export class PhotoAgentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') after?: string;
  @ApiPropertyOptional({ type: Number, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
export class PhotoCityDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) id!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) country!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) region!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
}
export class ProposePhotoDto {
  @ApiProperty() @IsUUID('4') assetId!: string;
  @ApiPropertyOptional({ type: PhotoCityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoCityDto)
  city?: PhotoCityDto;
  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  evidenceIds!: string[];
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(2000) rationale!: string;
  @ApiProperty() @IsBoolean() visualReviewed!: boolean;
}
export class InferPhotoCitiesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  cameraModel?: string;
  @ApiProperty({ type: [PhotoCityDto], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PhotoCityDto)
  cities!: PhotoCityDto[];
  @ApiProperty({ minimum: -86400, maximum: 86400 })
  @IsInt()
  @Min(-86400)
  @Max(86400)
  offsetSeconds = 0;
}
export class ScorePhotoCandidatesDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) description!: string;
}
export class ReviewPhotoSuggestionDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] }) @IsIn(['ACCEPT', 'REJECT']) action!:
    'ACCEPT' | 'REJECT';
  @ApiPropertyOptional({ type: PhotoCityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoCityDto)
  city?: PhotoCityDto;
}
