import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectLivePhotoImage } from './live-photo';
test('cover-only import detects a motion component without probing or transcoding it', async () => {
 const dir=await mkdtemp(join(tmpdir(),'cached-motion-'));
 try {const path=join(dir,'image.jpg');await writeFile(path,Buffer.concat([Buffer.from([255,216]),Buffer.from('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="200"/>'),Buffer.alloc(200)]));
 await assert.rejects(inspectLivePhotoImage(path, false), /MOTION_COMPONENT_DEFERRED/);
 } finally {await rm(dir,{recursive:true});}
});
