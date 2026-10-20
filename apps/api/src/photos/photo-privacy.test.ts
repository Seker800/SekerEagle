import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotoManagementService } from './photo-management.service';
test('人物隐私拥有服务端规则入口', () => {
  assert.equal(typeof PhotoManagementService.prototype['setPersonPrivacy' as keyof PhotoManagementService], 'function');
});
