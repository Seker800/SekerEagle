import type { Provider } from '@nestjs/common';
import type { LibraryMode } from '@prisma/client';
import { EagleDuplicateService } from './eagle-duplicates.service';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';
import { EagleImageSearchService } from './eagle-image-search.service';
import { EagleAiTagService } from './eagle-ai-tag.service';
import { EagleEmbeddingClient } from './eagle-embedding-client';
import { EagleBrowserCaptureService } from './eagle-browser-capture.service';
import { EagleImportService } from './eagle-import.service';
import { EagleMediaService } from './eagle-media.service';
import { EagleMaintenanceService } from './eagle-maintenance.service';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';
import { EagleProcessingService } from './eagle-processing.service';
import { EagleTaskCenterService } from './eagle-task-center.service';
import { EagleVectorService } from './eagle-vector.service';
import { EagleService } from './eagle.service';
import { EaglePrivacyService } from './eagle-privacy.service';
import { EagleUploadService } from './eagle-upload.service';
import { EagleUploadRecoveryService } from './eagle-upload-recovery.service';
import { EagleUploadInspectionService } from './eagle-upload-inspection.service';
import { PrismaSekerEagleIngestionAdapter } from './adapters/prisma/seker-eagle-ingestion.adapter';
import { PrismaEagleImportsRepository } from './import/adapters/prisma/eagle-app-import.repository';
import { EAGLE_IMPORTS_REPOSITORY } from './import/eagle-app-import.repository';
import { EagleImportsService } from './import/eagle-app-import.service';
import { SEKER_EAGLE_INGESTION_PORT } from './seker-eagle-ingestion.port';

export interface LibraryCapability {
  readonly id: string;
  readonly modes: readonly LibraryMode[];
  readonly providers: readonly Provider[];
  readonly tables: readonly string[];
  readonly dependsOn: readonly string[];
}

/** Ownership and assembly are one registry; a reference to a table does not transfer its ownership. */
export const EAGLE_LIBRARY_CAPABILITIES = [
  {
    id: 'assets',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleService, EaglePrivacyService],
    tables: [
      'EagleAsset',
      'EagleAssetAnnotation',
      'EagleManualTag',
      'EagleManualTagGroup',
      'EagleManualTagGroupMembership',
      'EagleAssetManualTag',
    ],
    dependsOn: ['search'],
  },
  {
    id: 'search',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [
      EagleImageSearchService,
      EagleAiTagService,
      EagleEmbeddingClient,
      EagleVectorService,
    ],
    tables: ['EagleEmbeddingSpace', 'EagleAssetEmbedding', 'EagleAiTag'],
    dependsOn: [],
  },
  {
    id: 'media',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleMediaService, EagleMediaCapabilityService],
    tables: ['EagleAssetRendition', 'EagleImagePyramid'],
    dependsOn: [],
  },
  {
    id: 'uploads',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleUploadService, EagleUploadRecoveryService, EagleUploadInspectionService],
    tables: ['UploadSession', 'UploadFinalizationJob', 'EagleUploadSessionState'],
    dependsOn: ['assets', 'media'],
  },
  {
    id: 'ingestion',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [
      EagleBrowserCaptureService,
      EagleImportService,
      EagleImportsService,
      PrismaEagleImportsRepository,
      PrismaSekerEagleIngestionAdapter,
      { provide: EAGLE_IMPORTS_REPOSITORY, useExisting: PrismaEagleImportsRepository },
      { provide: SEKER_EAGLE_INGESTION_PORT, useExisting: PrismaSekerEagleIngestionAdapter },
    ],
    tables: [
      'EagleBrowserCapture',
      'EagleImportRun',
      'EagleImportRunItem',
      'EagleImportManifestChunk',
      'EagleImportFolderDefinition',
      'EagleImportTagDefinition',
      'EagleImportTagGroupDefinition',
    ],
    dependsOn: ['uploads'],
  },
  {
    id: 'transfers',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleLibraryTransferService],
    tables: ['EagleLibraryTransfer'],
    dependsOn: ['assets', 'media'],
  },
  {
    id: 'duplicates',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleDuplicateService],
    tables: ['EagleDuplicateFingerprint', 'EagleDuplicateGroup', 'EagleDuplicateDismissal'],
    dependsOn: ['assets'],
  },
  {
    id: 'operations',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleAssetOperationService],
    tables: ['EagleAssetOperation', 'EagleAssetOperationItem'],
    dependsOn: ['assets', 'transfers', 'duplicates'],
  },
  {
    id: 'processing',
    modes: ['MATERIAL', 'PHOTO'],
    providers: [EagleProcessingService, EagleTaskCenterService],
    tables: ['EagleAssetProcessingJob', 'EagleProcessingSetting', 'EagleTaskPolicy'],
    dependsOn: ['media'],
  },
  {
    id: 'maintenance',
    modes: ['MATERIAL'],
    providers: [EagleMaintenanceService],
    tables: [],
    dependsOn: ['uploads'],
  },
] as const satisfies readonly LibraryCapability[];

export function libraryProviders(mode: LibraryMode): Provider[] {
  return EAGLE_LIBRARY_CAPABILITIES.filter((capability) =>
    (capability.modes as readonly LibraryMode[]).includes(mode),
  ).flatMap((capability) => [...capability.providers]);
}

/** Compatibility name for runtime identity checks; both modules use libraryProviders(mode). */
export const EAGLE_LIBRARY_PROVIDERS = libraryProviders('MATERIAL');
