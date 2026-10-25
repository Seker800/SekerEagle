import { mediaSubprocessEnvironment } from './subprocess-environment';
export { mediaSubprocessEnvironment } from './subprocess-environment';
import { normalizeLivePhotoIdentifier } from './live-photo';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CAMERA_MAX_DECODED_RAW_PIXELS,
  CAMERA_MAX_RAW_PIXELS,
  CAMERA_MAX_VIDEO_DURATION_MS,
} from '@sekereagle/library-core';
const run = promisify(execFile);
export interface CameraDimensions {
  width: number;
  height: number;
}
export interface CameraRawDimensions extends CameraDimensions {
  decodedWidth?: number;
  decodedHeight?: number;
  embeddedThumbnail?: boolean;
  embeddedPreview?: boolean;
}
export interface CameraVideoProbe {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: Array<{ rotation?: number }>;
    disposition?: { attached_pic?: number };
  }>;
}
const containers: Record<string, string[]> = {
  'video/mp4': ['mov', 'mp4'],
  'video/quicktime': ['mov', 'mp4'],
  'video/mp2t': ['mpegts'],
  'video/x-msvideo': ['avi'],
  'application/mxf': ['mxf'],
  'video/mpeg': ['mpeg'],
};
export const CAMERA_VIDEO_INPUT_OPTIONS = [
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  'mov,mpegts,avi,mxf,mpeg',
] as const;
export function parseCameraVideoProbe(probe: CameraVideoProbe, mimeType: string) {
  const formats = (probe.format?.format_name ?? '').split(',');
  if (!containers[mimeType]?.some((format) => formats.includes(format)))
    throw new Error('视频内容与声明容器不匹配。');
  const video = probe.streams?.find(
    (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  );
  if (
    !video ||
    ![
      'h264',
      'hevc',
      'prores',
      'dnxhd',
      'mpeg2video',
      'mpeg4',
      'mjpeg',
      'dvvideo',
      'h263',
    ].includes(video.codec_name ?? '')
  )
    throw new Error('不支持该相机视频编码。');
  const width = video.width ?? 0,
    height = video.height ?? 0;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 100_000_000
  )
    throw new Error('视频尺寸超出安全限制。');
  const seconds = Number(probe.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > CAMERA_MAX_VIDEO_DURATION_MS)
    throw new Error('视频时长无效或超过四小时限制。');
  const rotation =
    video.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ??
    Number(video.tags?.rotate ?? 0);
  const swapped = Math.abs(rotation) % 180 === 90;
  return {
    width: swapped ? height : width,
    height: swapped ? width : height,
    durationMs: Math.round(seconds * 1000),
  };
}
export async function probeCameraVideo(inputPath: string, mimeType: string) {
  const { stdout } = await run(
    process.env.FFPROBE_PATH?.trim() || 'ffprobe',
    [
      '-v',
      'error',
      ...CAMERA_VIDEO_INPUT_OPTIONS,
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      inputPath,
    ],
    { env: mediaSubprocessEnvironment(), timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const probe = JSON.parse(stdout) as CameraVideoProbe;
  const livePhotoIdentifier = normalizeLivePhotoIdentifier(
    probe.format?.tags?.['com.apple.quicktime.content.identifier'],
  );
  return {
    ...parseCameraVideoProbe(probe, mimeType),
    ...(livePhotoIdentifier ? { livePhotoIdentifier } : {}),
  };
}
export async function transcodeCameraVideo(
  inputPath: string,
  outputPath: string,
  durationMs: number,
) {
  await run(
    process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-y',
      ...CAMERA_VIDEO_INPUT_OPTIONS,
      '-i',
      inputPath,
      '-map',
      '0:V:0',
      '-map',
      '0:a:0?',
      '-sn',
      '-dn',
      '-vf',
      "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ac',
      '2',
      '-map_metadata',
      '-1',
      '-movflags',
      '+faststart',
      '-fs',
      String(1024 * 1024 * 1024),
      outputPath,
    ],
    { env: mediaSubprocessEnvironment(), timeout: 30 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 },
  );
  const preview = await probeCameraVideo(outputPath, 'video/mp4');
  if (
    Math.abs(preview.durationMs - durationMs) > 1000 ||
    (await stat(outputPath)).size >= 1024 * 1024 * 1024
  )
    throw new Error('视频播放副本超出处理预算，未保存不完整预览。');
  return preview;
}
export async function readCameraRaw(
  inputPath: string,
  outputPath?: string,
  thumbnailPath?: string,
  purpose: 'BROWSE' | 'DEVELOP' = 'DEVELOP',
): Promise<CameraRawDimensions> {
  const script = join(__dirname, '../python/raw_image.py');
  const { stdout } = await run(
    process.env.CAMERA_RAW_PYTHON?.trim() || 'python3',
    [
      script,
      inputPath,
      String(CAMERA_MAX_RAW_PIXELS),
      String(CAMERA_MAX_DECODED_RAW_PIXELS),
      ...(outputPath ? [outputPath, ...(thumbnailPath ? [thumbnailPath] : [])] : []),
      ...(purpose === 'BROWSE' && outputPath ? ['--browse'] : []),
    ],
    {
      timeout: outputPath ? 180_000 : 60_000,
      maxBuffer: 256 * 1024,
      env: mediaSubprocessEnvironment(),
    },
  );
  const result = JSON.parse(stdout) as CameraRawDimensions;
  if (
    !Number.isSafeInteger(result.width) ||
    !Number.isSafeInteger(result.height) ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.width * result.height > CAMERA_MAX_RAW_PIXELS
  )
    throw new Error('RAW 图片尺寸无效或超出安全限制。');
  if (
    outputPath &&
    (!Number.isSafeInteger(result.decodedWidth) ||
      !Number.isSafeInteger(result.decodedHeight) ||
      result.decodedWidth! <= 0 ||
      result.decodedHeight! <= 0 ||
      result.decodedWidth! * result.decodedHeight! > CAMERA_MAX_DECODED_RAW_PIXELS)
  )
    throw new Error('RAW 显影尺寸无效或超出安全限制。');
  return result;
}

export {
  normalizeLivePhotoIdentifier,
  readAppleLivePhotoIdentifier,
  readMotionPhotoRange,
  LIVE_PHOTO_MAX_VIDEO_BYTES,
  LIVE_PHOTO_MAX_DURATION_MS,
} from './live-photo';

export { readPhotoMetadataTags } from './photo-metadata';
export { probeHeifFile, decodeHeifFile, assertSafeHeifInfo } from './heif';
