import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsArray, IsIn, IsUUID, ValidateBy } from 'class-validator';
import { ASSET_OPERATION_KINDS, type AssetOperationKind } from '@sekereagle/library-core';
export class EnqueueAssetOperationDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ enum: [...ASSET_OPERATION_KINDS] })
  @IsIn(ASSET_OPERATION_KINDS)
  kind!: AssetOperationKind;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ValidateBy({
    name: 'uniqueAssetIds',
    validator: {
      validate: (value: unknown) => Array.isArray(value) && new Set(value).size === value.length,
      defaultMessage: () => 'assetIds must contain unique values',
    },
  })
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class ListAssetOperationsDto {
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  publicOnly?: 'true' | 'false';
}
