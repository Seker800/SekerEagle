import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EagleRenditionResponseDto } from './eagle-asset-update.dto';

export class EagleManualTagResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
}

export class EagleAiTagResponseDto {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) confidence!: number;
  @ApiProperty({ enum: ['ACTIVE', 'HIDDEN', 'REJECTED'] }) status!:
    'ACTIVE' | 'HIDDEN' | 'REJECTED';
}

export class EaglePhotoMetadataResponseDto {
  @ApiPropertyOptional({ type: Boolean }) captureMetadataInherited?: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) capturedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) capturedLocal!: string | null;
  @ApiProperty({ type: Boolean }) captureTimeZoneKnown!: boolean;
  @ApiProperty({ type: String, nullable: true }) cameraMake!: string | null;
  @ApiProperty({ type: String, nullable: true }) cameraModel!: string | null;
  @ApiProperty({ type: String, nullable: true }) lensModel!: string | null;
  @ApiProperty({ type: Number, nullable: true }) focalLength!: number | null;
  @ApiProperty({ type: Number, nullable: true }) aperture!: number | null;
  @ApiProperty({ type: Number, nullable: true }) exposureSeconds!: number | null;
  @ApiProperty({ type: Number, nullable: true }) iso!: number | null;
  @ApiProperty({ type: Number, nullable: true }) latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true }) longitude!: number | null;
  @ApiProperty({ type: Number, nullable: true }) altitude!: number | null;
  @ApiProperty({ type: Number, nullable: true }) sharpnessScore!: number | null;
  @ApiProperty({ type: String, nullable: true }) perceptualHash!: string | null;
}

export class EaglePhotoLocationResponseDto {
  @ApiProperty({ type: Number }) assetRevision!: number;
  @ApiProperty({ type: String }) cityId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) country!: string;
  @ApiProperty({ type: String }) region!: string;
  @ApiProperty({ type: Number }) latitude!: number;
  @ApiProperty({ type: Number }) longitude!: number;
  @ApiProperty({ enum: ['INFERRED', 'MANUAL'] }) source!: string;
}

export class EagleLivePhotoMotionResponseDto {
  @ApiProperty({ type: String }) assetId!: string;
  @ApiProperty({ type: String }) renditionId!: string;
  @ApiProperty({ type: Number }) revision!: number;
}

export class EagleAssetListResponseDto {
  @ApiPropertyOptional({ type: EagleLivePhotoMotionResponseDto })
  livePhotoMotion?: EagleLivePhotoMotionResponseDto;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) chronologicalAt?: Date;
  @ApiPropertyOptional({ type: EaglePhotoMetadataResponseDto, nullable: true })
  photoMetadata?: EaglePhotoMetadataResponseDto | null;
  @ApiPropertyOptional({ type: EaglePhotoLocationResponseDto, nullable: true })
  photoLocation?: EaglePhotoLocationResponseDto | null;
  @ApiPropertyOptional({ enum: ['MATERIAL', 'PHOTO'] }) libraryMode?: 'MATERIAL' | 'PHOTO';
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) originalName!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: String }) mimeType!: string;
  @ApiProperty({ type: String }) format!: string;
  @ApiProperty({ type: Number }) byteSize!: number;
  @ApiProperty({ type: Number, nullable: true }) width!: number | null;
  @ApiProperty({ type: Number, nullable: true }) height!: number | null;
  @ApiProperty({ type: Number, nullable: true }) durationMs!: number | null;
  @ApiProperty({ enum: ['PROCESSING', 'READY', 'FAILED'] }) lifecycleStatus!:
    'PROCESSING' | 'READY' | 'FAILED';
  @ApiProperty({ type: String, nullable: true }) mediaErrorCode!: string | null;
  @ApiProperty({ type: Number }) mediaRevision!: number;
  @ApiProperty({ type: Number }) rowVersion!: number;
  @ApiProperty({ type: Number, nullable: true, enum: [1, 2, 3, 4, 5] }) rating!: number | null;
  @ApiPropertyOptional({ type: Boolean }) isPrivate?: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) libraryAddedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt!: Date | null;
  @ApiPropertyOptional({ type: String }) originalUrl?: string;
  @ApiProperty({ type: [EagleRenditionResponseDto] }) renditions!: EagleRenditionResponseDto[];
  @ApiProperty({ type: [EagleManualTagResponseDto] }) manualTags!: EagleManualTagResponseDto[];
}

export class EaglePrivacyReasonResponseDto {
  @ApiProperty({ enum: ['TAG', 'PERSON'] }) kind!: 'TAG' | 'PERSON';
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
}

export class EagleAnnotationResponseDto {
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
}

export class EagleColorSwatchResponseDto {
  @ApiProperty({ type: Number }) rank!: number;
  @ApiProperty({ type: String }) hex!: string;
  @ApiProperty({ type: Number }) weight!: number;
  @ApiProperty({ type: Number }) labL!: number;
  @ApiProperty({ type: Number }) labA!: number;
  @ApiProperty({ type: Number }) labB!: number;
}

export class EagleColorAnalysisResponseDto {
  @ApiProperty({ type: Number }) assetRevision!: number;
  @ApiProperty({ type: String }) processorVersion!: string;
  @ApiProperty({ enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] }) status!:
    'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: [EagleColorSwatchResponseDto] }) swatches!: EagleColorSwatchResponseDto[];
}

export class EagleAssetResponseDto extends EagleAssetListResponseDto {
  @ApiPropertyOptional({ type: [EaglePrivacyReasonResponseDto] })
  privacyReasons?: EaglePrivacyReasonResponseDto[];
  @ApiProperty({ type: EagleAnnotationResponseDto, nullable: true })
  annotation!: EagleAnnotationResponseDto | null;
  @ApiProperty({ type: [EagleAiTagResponseDto] }) aiTags!: EagleAiTagResponseDto[];
  @ApiProperty({ type: EagleColorAnalysisResponseDto, nullable: true })
  colorAnalysis!: EagleColorAnalysisResponseDto | null;
}

export class EaglePhotoStackResponseDto {
  @ApiPropertyOptional({ type: String, format: 'date-time' }) timelineAt?: string;
  @ApiPropertyOptional({ type: [String] }) processingAssetIds?: string[];
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) bestAssetId!: string;
  @ApiProperty({ type: Boolean }) bestSelectedByUser!: boolean;
  @ApiProperty({ type: [String] }) assetIds!: string[];
  @ApiProperty({ type: EagleAssetListResponseDto }) cover!: EagleAssetListResponseDto;
}

export class EagleColorCoverageResponseDto {
  @ApiProperty({ type: Number }) eligible!: number;
  @ApiProperty({ type: Number }) completed!: number;
  @ApiProperty({ type: Number }) percentage!: number;
  @ApiProperty({ type: String }) processorVersion!: string;
}

export class EagleImageSearchResponseDto {
  @ApiProperty({ enum: ['READY', 'UNAVAILABLE'] }) status!: 'READY' | 'UNAVAILABLE';
  @ApiProperty({ type: String }) spaceId!: string;
}

export class EagleAssetPageResponseDto {
  @ApiPropertyOptional({ type: String, nullable: true }) previousCursor?: string | null;
  @ApiPropertyOptional({ type: [EaglePhotoStackResponseDto] })
  photoStacks?: EaglePhotoStackResponseDto[];
  @ApiProperty({ type: [EagleAssetListResponseDto] }) items!: EagleAssetListResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({ type: EagleColorCoverageResponseDto, nullable: true })
  colorCoverage!: EagleColorCoverageResponseDto | null;
  @ApiPropertyOptional({ type: EagleImageSearchResponseDto })
  imageSearch?: EagleImageSearchResponseDto;
}
