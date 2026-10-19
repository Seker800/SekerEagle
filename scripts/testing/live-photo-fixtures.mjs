import { Buffer } from 'node:buffer';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const run = promisify(execFile);
export const LIVE_PHOTO_FIXTURE_IDENTIFIER = 'c94808dc-251e-40b0-b2a3-85b23134c526';
function app1(payload) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
}
function insert(jpeg, payload) {
  return Buffer.concat([jpeg.subarray(0, 2), app1(payload), jpeg.subarray(2)]);
}
export async function createLivePhotoFixtures(directory, source) {
  await mkdir(directory, { recursive: true });
  const jpeg = await sharp(
    source ?? { create: { width: 240, height: 160, channels: 3, background: '#b58c46' } },
  )
    .jpeg()
    .toBuffer();
  const maker = Buffer.alloc(72);
  maker.write('Apple iOS\0');
  maker.write('MM', 12);
  maker.writeUInt16BE(1, 14);
  maker.writeUInt16BE(17, 16);
  maker.writeUInt16BE(2, 18);
  maker.writeUInt32BE(37, 20);
  maker.writeUInt32BE(32, 24);
  maker.write(LIVE_PHOTO_FIXTURE_IDENTIFIER, 32);
  const tiff = Buffer.alloc(44 + maker.length);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x927c, 28);
  tiff.writeUInt16LE(7, 30);
  tiff.writeUInt32LE(maker.length, 32);
  tiff.writeUInt32LE(44, 36);
  maker.copy(tiff, 44);
  const apple = insert(jpeg, Buffer.concat([Buffer.from('Exif\0\0'), tiff]));
  const moviePath = join(directory, 'apple.mov');
  await run(
    process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=240x160:rate=15',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-metadata',
      `com.apple.quicktime.content.identifier=${LIVE_PHOTO_FIXTURE_IDENTIFIER}`,
      '-movflags',
      'use_metadata_tags',
      moviePath,
    ],
    { timeout: 120000 },
  );
  const movie = await readFile(moviePath);
  const xmp = `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1"><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="${movie.length}" Item:Padding="0"/></x:xmpmeta>`;
  const embedded = Buffer.concat([insert(jpeg, Buffer.from(xmp)), movie]);
  const fixtures = [
    { name: 'apple-live.jpg', mimeType: 'image/jpeg', bytes: apple },
    { name: 'apple-live.mov', mimeType: 'video/quicktime', bytes: movie },
    { name: 'android-motion.jpg', mimeType: 'image/jpeg', bytes: embedded },
    { name: 'ordinary.jpg', mimeType: 'image/jpeg', bytes: jpeg },
  ];
  for (const fixture of fixtures) await writeFile(join(directory, fixture.name), fixture.bytes);
  return fixtures;
}
