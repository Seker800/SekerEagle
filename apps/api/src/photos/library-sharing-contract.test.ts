import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { EagleController } from '../eagle/eagle.controller';
import { EagleUploadController } from '../eagle/eagle-upload.controller';
import { EagleAiTagController } from '../eagle/eagle-ai-tag.controller';
import { EagleVectorController } from '../eagle/eagle-vector.controller';
import { EagleProcessingController } from '../eagle/eagle-processing.controller';
import { EagleModule, EAGLE_LIBRARY_PROVIDERS } from '../eagle/eagle.module';
import { EagleMaintenanceService } from '../eagle/eagle-maintenance.service';
import { LIBRARY_MODE } from '../eagle/library-mode';
import {
  PhotoLibraryModule,
  PhotosController,
  PhotoUploadsController,
  PhotoAiTagsController,
  PhotoVectorsController,
  PhotoProcessingController,
} from './photo-library.module';

const pairs = [
  [EagleController, PhotosController],
  [EagleUploadController, PhotoUploadsController],
  [EagleAiTagController, PhotoAiTagsController],
  [EagleVectorController, PhotoVectorsController],
  [EagleProcessingController, PhotoProcessingController],
] as const;
for (const [material, photo] of pairs) {
  test(`${photo.name} exposes every common route through the exact inherited handler`, () => {
    const registered = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PhotoLibraryModule,
    ) as unknown[];
    assert.ok(registered.includes(photo), 'inherited adapter must actually be registered');
    assert.equal(Reflect.getMetadata(LIBRARY_MODE, photo), 'PHOTO');
    assert.equal(Object.getPrototypeOf(photo.prototype), material.prototype);
    let routes = 0;
    for (const name of Object.getOwnPropertyNames(material.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(material.prototype, name)?.value as unknown;
      if (
        typeof handler !== 'function' ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      )
        continue;
      routes++;
      const photoHandler = Reflect.get(photo.prototype, name) as unknown;
      assert.ok(typeof photoHandler === 'function');
      assert.equal(photoHandler, handler, `${name} cannot fork its behavior, DTOs or guards`);
      for (const metadata of [PATH_METADATA, METHOD_METADATA, GUARDS_METADATA]) {
        assert.deepEqual(
          Reflect.getMetadata(metadata, photoHandler),
          Reflect.getMetadata(metadata, handler),
        );
      }
    }
    assert.ok(routes > 0, 'contract must exercise real routes');
  });
}
test('both registered modules bind the same common providers with separate immutable modes', () => {
  for (const [module, mode] of [
    [EagleModule, 'MATERIAL'],
    [PhotoLibraryModule, 'PHOTO'],
  ] as const) {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as any[];
    for (const provider of EAGLE_LIBRARY_PROVIDERS) {
      if (mode === 'PHOTO' && provider === EagleMaintenanceService) continue;
      const token =
        typeof provider === 'function' ? provider : (provider as { provide: unknown }).provide;
      const matches = providers.filter(
        (entry) => (typeof entry === 'function' ? entry : entry.provide) === token,
      );
      assert.deepEqual(matches, [provider], 'common provider identity and uniqueness are required');
    }
    assert.deepEqual(
      providers.filter((entry) => entry.provide === LIBRARY_MODE),
      [{ provide: LIBRARY_MODE, useValue: mode }],
    );
  }
});
