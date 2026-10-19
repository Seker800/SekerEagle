import assert from 'node:assert/strict';
import test from 'node:test';
import { GoneException } from '@nestjs/common';
import { EagleImportService } from './eagle-import.service';
test('legacy import completion is retired without reading or mutating client-selected assets', async () => {
  await assert.rejects(
    new EagleImportService({} as never).finishItem('owner-a', 'run-a', 'item-a', 'asset-a'),
    GoneException,
  );
});
