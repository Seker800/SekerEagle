import { ApiProperty } from '@nestjs/swagger';

export class EagleRenditionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() variant!: string;
  @ApiProperty({ enum: ['THUMBNAIL', 'PREVIEW', 'POSTER'] }) kind!:
    'THUMBNAIL' | 'PREVIEW' | 'POSTER';
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ type: Number }) byteSize!: number;
  @ApiProperty({ type: Number, nullable: true }) width!: number | null;
  @ApiProperty({ type: Number, nullable: true }) height!: number | null;
}
export class EagleAssetUpdateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: Number }) mediaRevision!: number;
  @ApiProperty({ enum: ['PROCESSING', 'READY', 'FAILED'] }) lifecycleStatus!:
    'PROCESSING' | 'READY' | 'FAILED';
  @ApiProperty({ type: String, nullable: true }) mediaErrorCode!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [EagleRenditionResponseDto] }) renditions!: EagleRenditionResponseDto[];
}
