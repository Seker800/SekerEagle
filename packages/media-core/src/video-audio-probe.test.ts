import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcodeCameraVideo } from './index';

test('the complete transcode path never treats missing audio counters as proof of no packets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-audio-proof-'));
  const old = { ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH };
  try {
    const probe = join(dir, 'probe.cjs');
    const encoder = join(dir, 'encoder.cjs');
    await writeFile(probe, `#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2),p=a.at(-1);
if(a.includes('-show_packets')) {const input=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(input.packets);process.stderr.write(input.packetError||'');}
else process.stdout.write(JSON.stringify({format:{format_name:'mov',duration:'1'},streams:[{codec_type:'video',codec_name:'h264',width:32,height:32},...(p.endsWith('input.mp4')?[{codec_type:'audio',codec_tag:'0x0000',sample_rate:'0',channels:0}]:[])]}));
`);
    await writeFile(encoder, `#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2);fs.writeFileSync(a.at(-1),'output');fs.writeFileSync(a.at(-1)+'.args',JSON.stringify(a));
`);
    await chmod(probe, 0o700);
    await chmod(encoder, 0o700);
    process.env.FFPROBE_PATH = probe;
    process.env.FFMPEG_PATH = encoder;
    const source = join(dir, 'input.mp4');
    const output = join(dir, 'output.mp4');
    for (const sample of [
      { packets: '0\n', omit: false },
      { packets: '', packetError: 'truncated input', omit: false },
      { packets: '', omit: true },
    ]) {
      await writeFile(source, JSON.stringify(sample));
      await transcodeCameraVideo(source, output, 1000);
      const args = JSON.parse(await readFile(output + '.args', 'utf8')) as string[];
      assert.equal(args.includes('-an'), sample.omit);
      assert.equal(args.includes('0:a:0?'), !sample.omit);
    }
  } finally {
    for (const [key, value] of [['FFMPEG_PATH', old.ffmpeg], ['FFPROBE_PATH', old.ffprobe]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
