import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsOptional, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator';
import { ASSET_OPERATION_KINDS, type AssetOperationKind } from '@sekereagle/library-core';
export class EnqueueAssetOperationDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ enum: [...ASSET_OPERATION_KINDS] })
  @IsIn(ASSET_OPERATION_KINDS)
  kind!: AssetOperationKind;
  @ApiProperty({ type: [String], maxItems: 1000 })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class ListAssetOperationsDto {
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  publicOnly?: 'true' | 'false';
}
