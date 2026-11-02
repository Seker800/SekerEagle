import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ASSET_OPERATION_KINDS,
  type AssetOperationSummary,
  type AssetOperationReceipt,
  type AssetMembershipFact,
  type AssetOperationResults,
} from '@sekereagle/library-core';

export class EagleOperationErrorResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() count!: number;
}
export class EagleOperationSummaryResponseDto implements AssetOperationSummary {
  @ApiPropertyOptional() undoOf?: string;
  @ApiPropertyOptional() commandType?: string;
  @ApiProperty() id!: string;
  @ApiProperty({ enum: [...ASSET_OPERATION_KINDS] }) kind!: AssetOperationSummary['kind'];
  @ApiProperty({ enum: ['MATERIAL', 'PHOTO'] }) libraryMode!: AssetOperationSummary['libraryMode'];
  @ApiProperty() total!: number;
  @ApiProperty() completed!: number;
  @ApiPropertyOptional() skipped?: number;
  @ApiProperty() failed!: number;
  @ApiProperty() queued!: number;
  @ApiProperty() running!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'STOPPED'] })
  state!: AssetOperationSummary['state'];
  @ApiProperty({ type: [EagleOperationErrorResponseDto] })
  errors!: EagleOperationErrorResponseDto[];
}
export class EagleOperationReceiptResponseDto implements AssetOperationReceipt {
  @ApiPropertyOptional() groupSignature?: string;
  @ApiProperty({ type: [String] }) assetIds!: string[];
  @ApiProperty() status!: string;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
}
export class EagleMembershipResponseDto implements AssetMembershipFact {
  @ApiProperty() id!: string;
  @ApiProperty({ type: Number, nullable: true }) rowVersion!: number | null;
  @ApiProperty({ enum: ['ACTIVE', 'TRASH', 'UNAVAILABLE'] }) state!: AssetMembershipFact['state'];
}
export class EagleOperationResultsResponseDto implements AssetOperationResults {
  @ApiProperty({ type: [EagleMembershipResponseDto] }) membership!: EagleMembershipResponseDto[];
  @ApiProperty({ type: EagleOperationSummaryResponseDto })
  operation!: EagleOperationSummaryResponseDto;
  @ApiProperty() revision!: string;
  @ApiProperty({ type: [EagleOperationReceiptResponseDto] })
  receipts!: EagleOperationReceiptResponseDto[];
  @ApiProperty({ type: Number, nullable: true }) nextCursor!: number | null;
}

/** Legacy duplicate endpoints return a queue reference rather than a summary. */
export class EagleDuplicateAdmissionResponseDto {
  @ApiProperty({ type: String, nullable: true }) operationId!: string | null;
  @ApiPropertyOptional({ type: [String] }) assetIds?: string[];
  @ApiPropertyOptional() alreadyAttempted?: boolean;
}
