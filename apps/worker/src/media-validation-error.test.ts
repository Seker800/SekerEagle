import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  isPermanentMediaValidationError,
  PermanentMediaValidationError,
} from './media-validation-error';

test('exhausts permanent image and video validation failures immediately', () => {
  assert.equal(
    isPermanentMediaValidationError(new PermanentMediaValidationError('IMAGE_DECODE_FAILED')),
    true,
  );
  assert.equal(isPermanentMediaValidationError(new BadRequestException('bad video')), true);
  assert.equal(
    isPermanentMediaValidationError(Object.assign(new Error('network'), { code: 'ECONNRESET' })),
    false,
  );
});
