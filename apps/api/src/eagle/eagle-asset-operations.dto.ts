import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsArray, IsIn, IsUUID } from 'class-validator';
import { ASSET_OPERATION_KINDS, type AssetOperationKind } from '@sekereagle/library-core';
const DIRECT_OPERATION_KINDS = ASSET_OPERATION_KINDS.filter(
  (kind) => kind !== 'DUPLICATE_SCAN' && kind !== 'DUPLICATE_CLEANUP',
);
export class EnqueueAssetOperationDto {
  @ApiProperty() @IsUUID('4') operationId!: string;
  @ApiProperty({ enum: [...DIRECT_OPERATION_KINDS] })
  @IsIn(DIRECT_OPERATION_KINDS)
  kind!: AssetOperationKind;
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class ListAssetOperationsDto {
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  publicOnly?: 'true' | 'false';
}
