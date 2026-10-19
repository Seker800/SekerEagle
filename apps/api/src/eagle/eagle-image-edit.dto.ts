import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsUUID, Min } from 'class-validator';
import type { ImageEdit } from '@sekereagle/library-core';

export class SaveImageEditDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  operationId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  rowVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  edit!: ImageEdit;
}
