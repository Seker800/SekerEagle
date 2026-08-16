import { ApiProperty } from '@nestjs/swagger';

export class EagleImageMediaCapabilityDto {
  @ApiProperty({ type: [String], example: ['image/jpeg', 'image/png'] })
  mimeTypes!: string[];

  @ApiProperty({ type: [String], example: ['.jpg', '.jpeg', '.png'] })
  extensions!: string[];

  @ApiProperty({ example: 104_857_600 })
  maxBytes!: number;

  @ApiProperty({ example: 50_000_000 })
  maxPixels!: number;
}

export class EagleVideoMediaCapabilityDto {
  @ApiProperty({ type: [String], example: ['video/mp4'] })
  mimeTypes!: string[];

  @ApiProperty({ type: [String], example: ['.mp4'] })
  extensions!: string[];

  @ApiProperty({ example: 104_857_600 })
  maxBytes!: number;

  @ApiProperty({ nullable: true, type: Number, example: null })
  maxDurationMs!: number | null;
}

export class EagleMediaCapabilitiesDto {
  @ApiProperty({ enum: [1], example: 1 })
  version!: 1;

  @ApiProperty({ type: EagleImageMediaCapabilityDto })
  images!: EagleImageMediaCapabilityDto;

  @ApiProperty({ type: EagleVideoMediaCapabilityDto })
  videos!: EagleVideoMediaCapabilityDto;
}
