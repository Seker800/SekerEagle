import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InitiateEagleUploadDto } from './eagle-upload.dto';
import { EagleUploadService } from './eagle-upload.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const input = {
  originalName: 'travel-edited.png',
  mimeType: 'image/png',
  size: 12,
  duplicatePolicy: 'CREATE_COPY',
};

test('edited source authorization is checked in its owner and library before allocating storage', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    let predicate: unknown;
    const service = new EagleUploadService(
      {
        eagleAsset: {
          findFirst: async ({ where }: { where: unknown }) => {
            predicate = where;
            return null;
          },
        },
        uploadSession: { create: async () => ({ id: 'session', size: 12n }) },
      } as never,
      { createMultipartUpload: async () => 'multipart' } as never,
      { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
      {} as never,
      mode,
    );
    await assert.rejects(
      () =>
        service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
          ...input,
          copySourceAssetId: 'source',
          copySourceRowVersion: 2,
        } as InitiateEagleUploadDto),
      NotFoundException,
    );
    assert.deepEqual(predicate, {
      id: 'source',
      ownerId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a',
      libraryMode: mode,
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    });
  }
});
test('stale edited-source versions cannot initiate a new copy', async () => {
  const service = new EagleUploadService(
    {
      eagleAsset: { findFirst: async () => ({ rowVersion: 3 }) },
      uploadSession: { create: async () => ({ id: 'session', size: 12n }) },
    } as never,
    { createMultipartUpload: async () => 'multipart' } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
    'MATERIAL',
  );
  await assert.rejects(
    () =>
      service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
        ...input,
        copySourceAssetId: 'source',
        copySourceRowVersion: 2,
      } as InitiateEagleUploadDto),
    ConflictException,
  );
});
test('edited-photo upload permits explicit copies but rejects owner and replacement injection', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  assert.equal(validateSync(plainToInstance(InitiateEagleUploadDto, input), options).length, 0);
  const errors = validateSync(
    plainToInstance(InitiateEagleUploadDto, {
      ...input,
      ownerId: 'victim',
      replacementAssetId: 'original',
    }),
    options,
  );
  assert.deepEqual(errors.map((error) => error.property).sort(), ['ownerId', 'replacementAssetId']);
  assert.ok(
    validateSync(
      plainToInstance(InitiateEagleUploadDto, { ...input, duplicatePolicy: 'OVERWRITE' }),
      options,
    ).some((error) => error.property === 'duplicatePolicy'),
  );
});
test('edited-photo copies derive every ownership field from the authenticated subject', async () => {
  let written: Record<string, any> = {};
  let objectKey = '';
  const service = new EagleUploadService(
    {
      uploadSession: {
        create: async ({ data }: { data: Record<string, any> }) => {
          written = data;
          return { id: 'session', size: 12n };
        },
      },
    } as never,
    {
      createMultipartUpload: async (key: string) => {
        objectKey = key;
        return 'multipart';
      },
    } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
    'MATERIAL',
  );
  await service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', input as InitiateEagleUploadDto);
  assert.equal(written.uploaderId, '5a1fd7d1-fd57-4e42-83f7-55425ca8704a');
  assert.deepEqual(written.eagleState.create.owner, {
    connect: { id: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a' },
  });
  assert.equal(written.eagleState.create.duplicatePolicy, 'CREATE_COPY');
  assert.equal(written.eagleState.create.replacementAssetId, undefined);
  assert.ok(objectKey.startsWith('users/5a1fd7d1-fd57-4e42-83f7-55425ca8704a/'));
});
test('ordinary uploads retain the previous skip-duplicate behavior', async () => {
  let policy: unknown;
  const service = new EagleUploadService(
    {
      uploadSession: {
        create: async ({
          data,
        }: {
          data: { eagleState: { create: { duplicatePolicy: unknown } } };
        }) => {
          policy = data.eagleState.create.duplicatePolicy;
          return { id: 'session', size: 12n };
        },
      },
    } as never,
    { createMultipartUpload: async () => 'multipart' } as never,
    { assertUploadAllowed: () => ({ mimeType: 'image/png' }) } as never,
    {} as never,
    'MATERIAL',
  );
  await service.initiate('5a1fd7d1-fd57-4e42-83f7-55425ca8704a', {
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
  });
  assert.equal(policy, 'SKIP');
});

test('edited source IDs and versions form a validated declaration without client privacy flags', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true };
  for (const invalid of [
    { copySourceAssetId: 'bad', copySourceRowVersion: 1 },
    { copySourceAssetId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a' },
    { copySourceRowVersion: 1 },
    { copySourceAssetId: '5a1fd7d1-fd57-4e42-83f7-55425ca8704a', copySourceRowVersion: 0 },
    { isPrivate: true },
  ]) {
    assert.ok(
      validateSync(plainToInstance(InitiateEagleUploadDto, { ...input, ...invalid }), options)
        .length,
    );
  }
});

for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  for (const [alreadyTagged, privateSource] of [
    [false, false],
    [true, false],
    [false, true],
  ] as const) {
    test(`edited copy adds one scoped edited tag and preserves existing labels (${mode}, already tagged: ${alreadyTagged}, private source: ${privateSource})`, async () => {
      const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
      let tagInput: any;
      let links: any[] = [];
      let created: any;
      const tx = {
        $queryRaw: async () => [],
        $executeRaw: async () => 0,
        uploadSession: { updateMany: async () => ({ count: 1 }), update: async () => undefined },
        eagleAsset: {
          findFirst: async () => ({
            rowVersion: 2,
            rating: 4,
            isPrivate: privateSource,
            annotation: null,
            manualTagLinks: [
              { tagId: 'travel', tag: { marksAssetsPrivate: false } },
              ...(alreadyTagged
                ? [{ tagId: 'edited', tag: { marksAssetsPrivate: alreadyTagged } }]
                : []),
            ],
          }),
          create: async ({ data }: any) => {
            created = data;
          },
        },
        eagleManualTag: {
          upsert: async (args: any) => {
            if (args.create.name === '继承私密')
              return { id: 'inherited', marksAssetsPrivate: true };
            tagInput = args;
            return { id: 'edited', marksAssetsPrivate: alreadyTagged };
          },
        },
        eagleAssetManualTag: {
          createMany: async ({ data }: any) => {
            links = data;
          },
        },
        eagleBrowserCapture: { findUnique: async () => null },
        eagleAssetProcessingJob: { createMany: async () => undefined },
        eagleUploadSessionState: { update: async () => undefined },
      };
      const service = new EagleUploadService(
        {
          uploadSession: {
            findFirst: async () => ({
              id: 'session',
              uploaderId: ownerId,
              status: 'ASSEMBLED',
              originalName: 'photo.png',
              mimeType: 'image/png',
              size: 12n,
              objectKey: 'local-test-object',
              completionParts: [{ PartNumber: 1, ETag: 'part' }],
              eagleState: {
                duplicatePolicy: 'CREATE_COPY',
                copySourceAssetId: 'source',
                copySourceRowVersion: 2,
              },
            }),
            count: async () => 1,
            updateMany: async () => ({ count: 1 }),
          },
          $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
            callback(tx),
        } as never,
        { headObject: async () => ({ ContentLength: 12 }) } as never,
        {} as never,
        {
          inspect: async () => ({
            sha256: 'a'.repeat(64),
            format: 'png',
            width: 20,
            height: 10,
            durationMs: null,
          }),
        } as never,
        mode,
      );
      const result = await service.complete(ownerId, 'session', {
        parts: [{ partNumber: 1, etag: 'part' }],
      });
      assert.ok(tagInput, 'editing must attach the edited marker');
      assert.deepEqual(tagInput.where.ownerId_libraryMode_normalizedName, {
        ownerId,
        libraryMode: mode,
        normalizedName: '已编辑',
      });
      assert.equal(tagInput.create.name, '已编辑');
      assert.deepEqual(tagInput.update, {}, 'existing tag preferences must remain intact');
      assert.deepEqual(
        links.map((link) => link.tagId).sort(),
        privateSource ? ['edited', 'inherited', 'travel'] : ['edited', 'travel'],
      );
      assert.ok(
        links.every(
          (link) =>
            link.ownerId === ownerId &&
            link.libraryMode === mode &&
            link.assetId === result.assetId,
        ),
      );
      assert.equal(
        created.isPrivate,
        alreadyTagged || privateSource,
        'a reused private marker must keep the output private',
      );
      assert.equal(created.rating, 4);
    });
  }
}
