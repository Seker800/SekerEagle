import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleUploadRecoveryService } from './eagle-upload-recovery.service';
import { EagleMaintenanceService } from './eagle-maintenance.service';

test('HTTP providers expose no auto-start lifecycle for recovery or maintenance', () => {
  const recovery = new EagleUploadRecoveryService({} as never, {} as never, {} as never, {} as never, 'PHOTO');
  const maintenance = new EagleMaintenanceService({} as never, {} as never);
  assert.equal('onModuleInit' in recovery, false);
  assert.equal('onModuleInit' in maintenance, false);
});
