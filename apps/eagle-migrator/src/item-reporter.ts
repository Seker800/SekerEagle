import type { MigrationJournal } from './journal';
import { classifyFailure, type FailureLike } from './retry-policy';

interface ImportItemReference {
  sourceItemId: string;
}

type ItemEvent =
  | { status: 'UPLOADING' }
  | { status: 'COMMITTING'; uploadSessionId: string }
  | { status: 'IMPORTED'; assetId: string; duplicate: boolean }
  | { status: 'SKIPPED'; code: string; message: unknown }
  | { status: 'FAILED'; error: FailureLike & { message?: unknown } };

export function createItemReporter(journal: MigrationJournal) {
  return (item: ImportItemReference, event: ItemEvent): Promise<void> => {
    switch (event.status) {
      case 'UPLOADING':
        journal.markUploading(item.sourceItemId);
        return Promise.resolve();
      case 'COMMITTING':
        journal.markCommitting(item.sourceItemId, { uploadSessionId: event.uploadSessionId });
        return Promise.resolve();
      case 'IMPORTED':
        journal.markImported(item.sourceItemId, {
          assetId: event.assetId,
          duplicate: event.duplicate,
        });
        return Promise.resolve();
      case 'SKIPPED':
        journal.markSkipped(item.sourceItemId, { code: event.code, message: event.message });
        return Promise.resolve();
      case 'FAILED': {
        const failure = {
          code: event.error.code ?? `HTTP_${event.error.status ?? 'UNKNOWN'}`,
          message: event.error.message ?? '迁移项处理失败。',
        };
        if (classifyFailure(event.error) === 'RETRYABLE')
          journal.markRetryable(item.sourceItemId, failure);
        else journal.markRejected(item.sourceItemId, failure);
        return Promise.resolve();
      }
    }
  };
}
