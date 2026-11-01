import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EagleService } from './eagle.service';

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`${mode} clear uses a bounded budget and rechecks authorization before commit`, async () => {
    let received: { timeout?: number } | undefined;
    const settings: unknown[][] = [];
    let checks = 0;
    const service = new EagleService(
      {
        $transaction: async (
          run: (tx: unknown) => Promise<unknown>,
          options?: { timeout?: number },
        ) => {
          received = options;
          return run({
            $executeRaw: async (_sql: unknown, ...values: unknown[]) => settings.push(values),
            $queryRaw: async () => [{ affectedAssetCount: 42 }],
          });
        },
      } as never,
      undefined,
      mode,
    );
    assert.deepEqual(
      await service.emptyTrash('owner', false, new Date(1), async () => {
        checks++;
      }),
      { affectedAssetCount: 42 },
    );
    assert.equal(received?.timeout, 12_000);
    assert.deepEqual(settings, [['11750ms']]);
    assert.equal(checks, 2, 'a lease/private grant may expire while SQL waits');
  });
  for (const [code, sqlCode] of [
    ['P2028', undefined],
    ['P2024', undefined],
    ['P2034', undefined],
    ['P2010', '57014'],
  ] as const) {
    test(`${mode} clear reports ${code}/${sqlCode ?? ''} as retryable busy`, async () => {
      const service = new EagleService(
        {
          $transaction: async () => {
            throw new Prisma.PrismaClientKnownRequestError('synthetic', {
              code,
              clientVersion: '6.19.3',
              ...(sqlCode ? { meta: { code: sqlCode } } : {}),
            });
          },
        } as never,
        undefined,
        mode,
      );
      await assert.rejects(
        service.emptyTrash('owner'),
        (error: unknown) =>
          error instanceof ServiceUnavailableException &&
          (error.getResponse() as { code: string }).code === 'EMPTY_TRASH_BUSY',
      );
    });
  }
}
test('clear validates its own budget before entering a transaction', async () => {
  const previous = process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
  try {
    for (const value of ['0', '999', '12001', 'NaN', '1.5']) {
      process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = value;
      let entered = false;
      const service = new EagleService(
        {
          $transaction: async () => {
            entered = true;
          },
        } as never,
        undefined,
        'PHOTO',
      );
      await assert.rejects(service.emptyTrash('owner'), /EAGLE_EMPTY_TRASH_TIMEOUT_MS/);
      assert.equal(entered, false);
    }
  } finally {
    if (previous === undefined) delete process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS;
    else process.env.EAGLE_EMPTY_TRASH_TIMEOUT_MS = previous;
  }
});
test('clear preserves domain/security errors', async () => {
  const failure = new Error('lease lost');
  const service = new EagleService(
    {
      $transaction: async () => {
        throw failure;
      },
    } as never,
    undefined,
    'PHOTO',
  );
  await assert.rejects(service.emptyTrash('owner'), (error: unknown) => error === failure);
});
