import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class DuplicateFilterDto {
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  sameName?: string;
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  sameCapturedAt?: string;
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  sameDimensions?: string;
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  sameFormat?: string;
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  sameBytes?: string;
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  protectEdits?: string;
  @ApiProperty({
    required: false,
    description: 'Every original must be smaller than this positive integer number of bytes.',
  })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  maxBytes?: string;
}
export class DuplicateListDto extends DuplicateFilterDto {
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^\d+$/) cursor?: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^[a-f0-9]{64}$/) revision?: string;
  @ApiProperty({ required: false, enum: ['ALL', 'EXACT', 'SIMILAR'] })
  @IsOptional()
  @IsIn(['ALL', 'EXACT', 'SIMILAR'])
  kind?: 'ALL' | 'EXACT' | 'SIMILAR';
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  showIgnored?: string;
}
export class DuplicateSelectionDto {
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) signature!: string;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  keepIds?: string[];
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  removeIds?: string[];
  @ValidateBy({
    name: 'oneGroupSelection',
    validator: {
      validate: (_value, args) => {
        const row = args!.object as DuplicateSelectionDto;
        return !!row.keepIds?.length !== !!row.removeIds?.length;
      },
    },
  })
  private readonly groupSelection?: never;
}
export class DuplicateKeepOverrideDto {
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) signature!: string;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  keepIds?: string[];
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  removeIds?: string[];
  @ValidateBy({
    name: 'overrideSelection',
    validator: {
      validate: (_v, args) => {
        const row = args!.object as DuplicateKeepOverrideDto;
        return !!row.keepIds?.length !== (row.removeIds !== undefined);
      },
    },
  })
  private readonly overrideSelection?: never;
}
export class DuplicateActionDto {
  @ApiProperty({ required: false, type: DuplicateListDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DuplicateListDto)
  filters?: DuplicateListDto;
  @ApiProperty({ required: false, type: [DuplicateKeepOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DuplicateKeepOverrideDto)
  keepOverrides?: DuplicateKeepOverrideDto[];
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^[a-f0-9]{64}$/) revision?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allExact?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allVerified?: boolean;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  signatures?: string[];
  @ApiProperty({ type: [DuplicateSelectionDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DuplicateSelectionDto)
  groups?: DuplicateSelectionDto[];
  @ValidateBy({
    name: 'oneSelection',
    validator: {
      validate: (_v, args) => {
        const obj = args!.object as DuplicateActionDto;
        const count =
          Number(obj.allExact === true) +
          Number(obj.allVerified === true) +
          Number(!!obj.signatures?.length) +
          Number(!!obj.groups?.length);
        return (
          count === 1 &&
          (!(obj.allExact || obj.allVerified || obj.signatures?.length) || !!obj.revision)
        );
      },
    },
  })
  private readonly selection?: never;
}
export class DuplicateScanDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() onlyIfUnattempted?: boolean;
}
export class DuplicateIgnoreDto {
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^[a-f0-9]{64}$/) signature?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allFiltered?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^[a-f0-9]{64}$/) revision?: string;
  @ApiProperty({ required: false, type: DuplicateListDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DuplicateListDto)
  filters?: DuplicateListDto;
  @ValidateBy({
    name: 'ignoreScope',
    validator: {
      validate: (_v, args) => {
        const obj = args!.object as DuplicateIgnoreDto;
        return (
          Number(!!obj.signature) + Number(obj.allFiltered === true) === 1 &&
          (!obj.allFiltered || !!obj.revision)
        );
      },
    },
  })
  private readonly ignoreScope?: never;
  @ApiProperty() @IsBoolean() ignored!: boolean;
}
