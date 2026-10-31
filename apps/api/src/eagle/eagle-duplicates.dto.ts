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
export class DuplicateListDto {
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
export class DuplicateActionDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(/^[a-f0-9]{64}$/) revision?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() allExact?: boolean;
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
        return obj.allExact === true ? !!obj.revision && !obj.groups?.length : !!obj.groups?.length;
      },
    },
  })
  private readonly selection?: never;
}
export class DuplicateScanDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
}
export class DuplicateIgnoreDto {
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) signature!: string;
  @ApiProperty() @IsBoolean() ignored!: boolean;
}
