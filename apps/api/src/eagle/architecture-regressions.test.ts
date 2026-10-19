import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, GoneException } from '@nestjs/common';
import { PatScopeGuard } from '../auth/pat-scope.guard';
import { EagleImportService } from './eagle-import.service';
import { ListEagleImportItemsDto, ListEagleImportRunsDto } from './eagle-import.dto';
import { validateSync } from 'class-validator';

test('PAT endpoints deny missing scope declarations while browser principals still work', () => {
  const guard = new PatScopeGuard({ getAllAndOverride: () => undefined } as never);
  const context = (kind: string) => ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: { kind, scopes: [] } }) }),
  });
  assert.throws(() => guard.canActivate(context('pat') as never), ForbiddenException);
  assert.equal(guard.canActivate(context('browser') as never), true);
});
test('legacy import finish cannot accept a client-supplied resource or modify a cancelled run', async () => {
  await assert.rejects(
    new EagleImportService({} as never).finishItem(
      'owner',
      'cancelled',
      'item',
      'arbitrary-private-asset',
    ),
    GoneException,
  );
});
test('invalid import statuses fail DTO validation rather than reaching Prisma as invalid enums', () => {
  for (const Type of [ListEagleImportItemsDto, ListEagleImportRunsDto]) {
    assert.ok(
      validateSync(Object.assign(new Type(), { status: 'NOT_A_STATUS' })).some(
        (e) => e.property === 'status',
      ),
    );
    assert.equal(validateSync(Object.assign(new Type(), { status: 'FAILED' })).length, 0);
  }
});
