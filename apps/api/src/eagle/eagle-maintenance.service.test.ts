import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleMaintenanceService } from './eagle-maintenance.service';

test('maintenance prunes old completed jobs in a bounded batch and retains recent import runs', async () => {
  const rawCalls: Array<{ sql: string; values: unknown[] }> = [];
  const importCalls: unknown[] = [];
  const service = new EagleMaintenanceService(
    {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        rawCalls.push({ sql: strings.join('?'), values });
        return 123;
      },
    } as never,
    {
      pruneTerminalRuns: async (input: unknown) => {
        importCalls.push(input);
        return 4;
      },
    } as never,
  );

  const result = await service.runMaintenance(new Date('2026-08-17T00:00:00.000Z'));

  assert.deepEqual(result, { completedJobsDeleted: 123, importRunsDeleted: 4 });
  assert.match(rawCalls[0]?.sql ?? '', /"status" = 'COMPLETED'/);
  assert.match(rawCalls[0]?.sql ?? '', /LIMIT/);
  assert.equal((rawCalls[0]?.values[0] as Date).toISOString(), '2026-07-18T00:00:00.000Z');
  assert.deepEqual(importCalls, [{ retentionDays: 30, keepPerLibrary: 10, limit: 100 }]);
});
