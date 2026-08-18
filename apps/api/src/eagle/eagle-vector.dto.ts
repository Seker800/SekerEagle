import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class SetTagRecommendationDto {
  @IsBoolean()
  recommendationEnabled!: boolean;
}

export class ListVectorSuggestionsDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 40;

  @IsOptional()
  @IsUUID('4')
  tagId?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['SCORE_DESC', 'NEWEST'])
  sort: 'SCORE_DESC' | 'NEWEST' = 'SCORE_DESC';
}

export class ListUnclassifiedVectorAssetsDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 40;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class ReviewVectorSuggestionDto {
  @IsIn(['ACCEPT', 'REJECT'])
  action!: 'ACCEPT' | 'REJECT';
}

export class BatchReviewVectorSuggestionsDto extends ReviewVectorSuggestionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  suggestionIds!: string[];
}

export class ListTagDistanceAssetsDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 40;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  direction: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsString()
  cursor?: string;
}
