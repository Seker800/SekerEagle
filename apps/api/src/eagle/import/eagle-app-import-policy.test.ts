import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canFinalizeEagleImportUpload,
  canPreflightEagleImport,
  canRunAcceptEagleImportUpload,
  canStageEagleImportManifest,
  canStartEagleImportUpload,
  isTerminalEagleImportItem,
  resolveEagleImportAction,
  resolveEagleImportRunCompletion,
} from './eagle-app-import-policy';

test('import policy owns run and item transition guards without persistence concerns', () => {
  assert.equal(canStageEagleImportManifest('DRAFT'), true);
  assert.equal(canStageEagleImportManifest('RUNNING'), false);
  assert.equal(canPreflightEagleImport('PREFLIGHTED'), true);
  assert.equal(canRunAcceptEagleImportUpload('RUNNING'), true);
  assert.equal(canStartEagleImportUpload('PREFLIGHTED', 'STAGED'), true);
  assert.equal(canStartEagleImportUpload('DRAFT', 'STAGED'), false);
  assert.equal(canFinalizeEagleImportUpload('FINALIZING'), true);
  assert.equal(isTerminalEagleImportItem('CANCELLED'), true);
  assert.equal(isTerminalEagleImportItem('UPLOADING'), false);
});

test('import policy classifies every incremental manifest action', () => {
  const base = {
    manifestVersion: 2,
    skippedCode: null,
    hasMappedAsset: true,
    priorMetadataHash: 'metadata-a',
    metadataHash: 'metadata-a',
    knownContentSha256: 'a'.repeat(64),
    contentSha256: 'a'.repeat(64),
  };
  assert.equal(resolveEagleImportAction({ ...base, hasMappedAsset: false }), 'NEW');
  assert.equal(resolveEagleImportAction(base), 'UNCHANGED');
  assert.equal(
    resolveEagleImportAction({ ...base, metadataHash: 'metadata-b' }),
    'METADATA_UPDATE',
  );
  assert.equal(
    resolveEagleImportAction({ ...base, contentSha256: 'b'.repeat(64) }),
    'CONTENT_REPLACE',
  );
  assert.equal(
    resolveEagleImportAction({ ...base, skippedCode: 'SOURCE_ITEM_DELETED' }),
    'SKIP_DELETED',
  );
  assert.equal(
    resolveEagleImportAction({ ...base, skippedCode: 'UNSUPPORTED_MEDIA' }),
    'SKIP_UNSUPPORTED',
  );
  assert.equal(
    resolveEagleImportAction({
      ...base,
      manifestVersion: 1,
      contentSha256: 'b'.repeat(64),
      metadataHash: 'metadata-b',
    }),
    'METADATA_UPDATE',
  );
});

test('import policy derives terminal run status from aggregate counts', () => {
  assert.equal(
    resolveEagleImportRunCompletion({
      activeItemCount: 1,
      importedItemCount: 0,
      skippedItemCount: 0,
      failedItemCount: 0,
    }),
    'RUNNING',
  );
  assert.equal(
    resolveEagleImportRunCompletion({
      activeItemCount: 0,
      importedItemCount: 1,
      skippedItemCount: 0,
      failedItemCount: 1,
    }),
    'PARTIAL',
  );
  assert.equal(
    resolveEagleImportRunCompletion({
      activeItemCount: 0,
      importedItemCount: 0,
      skippedItemCount: 0,
      failedItemCount: 1,
    }),
    'FAILED',
  );
});

