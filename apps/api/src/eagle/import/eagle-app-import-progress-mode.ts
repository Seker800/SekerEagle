export type EagleImportProgressMode = 'SYNC_COMPAT' | 'PROJECTED';

export function eagleImportProgressMode(): EagleImportProgressMode {
  return process.env.EAGLE_IMPORT_PROGRESS_MODE === 'PROJECTED' ? 'PROJECTED' : 'SYNC_COMPAT';
}

