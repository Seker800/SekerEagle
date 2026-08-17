export const SEKER_EAGLE_INGESTION_PORT = Symbol('SEKER_EAGLE_INGESTION_PORT');

export interface SekerEagleIngestionTagGroup {
  name: string;
  normalizedName: string;
  color: string | null;
  description: string | null;
}

export interface SekerEagleIngestionTag {
  name: string;
  normalizedName: string;
  color: string | null;
  isStarred: boolean;
  groups: SekerEagleIngestionTagGroup[];
}

export interface SekerEagleIngestionCommand {
  sourceKey: string;
  ownerId: string;
  assetId: string;
  displayName: string;
  rating: number | null;
  libraryAddedAt: Date | null;
  description: string | null;
  sourceUrl: string | null;
  tags: SekerEagleIngestionTag[];
}

export interface SekerEagleIngestionPort<TTransaction = unknown> {
  applyMetadata(command: SekerEagleIngestionCommand, transaction: TTransaction): Promise<void>;
}
