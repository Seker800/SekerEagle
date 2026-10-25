import { CAMERA_MAX_IMAGE_BYTES, CAMERA_MAX_VIDEO_BYTES } from '@sekereagle/library-core';
import { ApiProperty } from '@nestjs/swagger';

export class EagleImageMediaCapabilityDto {
  @ApiProperty({ type: [String], example: ['image/jpeg', 'image/png'] })
  mimeTypes!: string[];

  @ApiProperty({ type: [String], example: ['.jpg', '.jpeg', '.png'] })
  extensions!: string[];

  @ApiProperty({
    type: [String],
    example: ['jpeg', 'png', 'heif'],
    description: 'Stored asset format values accepted by the list format filter.',
  })
  formats!: string[];

  @ApiProperty({ example: CAMERA_MAX_IMAGE_BYTES })
  maxBytes!: number;

  @ApiProperty({ example: 120_000_000 })
  maxPixels!: number;

  @ApiProperty({ example: 120_000_000 })
  maxRawPixels!: number;

  @ApiProperty({
    example: 64_000_000,
    description: 'Aggregate HEIC/HEIF pixel limit for whole-frame native decoding.',
  })
  maxHeifPixels!: number;
}

export class EagleVideoMediaCapabilityDto {
  @ApiProperty({ type: [String], example: ['video/mp4'] })
  mimeTypes!: string[];

  @ApiProperty({ type: [String], example: ['.mp4'] })
  extensions!: string[];

  @ApiProperty({
    type: [String],
    example: ['mp4', 'mov'],
    description: 'Stored asset format values accepted by the list format filter.',
  })
  formats!: string[];

  @ApiProperty({ example: CAMERA_MAX_VIDEO_BYTES })
  maxBytes!: number;

  @ApiProperty({ nullable: true, type: Number, example: 14_400_000 })
  maxDurationMs!: number | null;
}

export class EagleMediaCapabilitiesDto {
  @ApiProperty({
    enum: [1],
    description: 'Supported server photo recipe protocol, not worker readiness.',
  })
  serverPhotoEditing!: 1;

  @ApiProperty({ enum: [1], example: 1 })
  version!: 1;

  @ApiProperty({ type: EagleImageMediaCapabilityDto })
  images!: EagleImageMediaCapabilityDto;

  @ApiProperty({ type: EagleVideoMediaCapabilityDto })
  videos!: EagleVideoMediaCapabilityDto;
}
