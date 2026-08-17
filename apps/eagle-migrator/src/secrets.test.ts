import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSensitiveText } from './secrets';

test('redacts PAT, bearer headers, and signed URL values from every persisted message', () => {
  const value = redactSensitiveText(
    'Authorization: Bearer se_pat_secret https://host/path?token=abc&x-amz-signature=def',
  );
  assert.doesNotMatch(value, /se_pat_secret|Bearer|token=abc|signature=def/i);
});

test('renders safe primitive failures and refuses object stringification', () => {
  assert.equal(redactSensitiveText(new Error('safe error')), 'safe error');
  assert.equal(redactSensitiveText(42), '42');
  assert.equal(redactSensitiveText(true), 'true');
  assert.equal(redactSensitiveText(null), '');
  assert.equal(redactSensitiveText({ secret: 'value' }), '[unprintable value]');
});
