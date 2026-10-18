import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const revision = '47534e27c9851bb1128ccc0102f1145e27f23f98';
const directory = resolve(process.argv[2] ?? '.runtime/photo-face/models');
const models = [
  [
    'face_detection_yunet',
    'face_detection_yunet_2023mar.onnx',
    'yunet.onnx',
    '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  ],
  [
    'face_recognition_sface',
    'face_recognition_sface_2021dec.onnx',
    'sface.onnx',
    '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  ],
];
await mkdir(directory, { recursive: true });
for (const [folder, name, target, checksum] of models) {
  const response = await fetch(
    `https://media.githubusercontent.com/media/opencv/opencv_zoo/${revision}/models/${folder}/${name}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok || Number(response.headers.get('content-length')) > 50 * 1024 * 1024)
    throw new Error('Model download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 50 * 1024 * 1024 ||
    createHash('sha256').update(bytes).digest('hex') !== checksum
  )
    throw new Error('Model checksum mismatch');
  await writeFile(join(directory, target), bytes);
  const license = await fetch(
    `https://raw.githubusercontent.com/opencv/opencv_zoo/${revision}/models/${folder}/LICENSE`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!license.ok) throw new Error('Model license download failed');
  await writeFile(join(directory, `${target}.LICENSE`), await license.text());
}
process.stdout.write('Verified local face models and their licenses are ready.\n');
