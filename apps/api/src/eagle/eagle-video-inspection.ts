import { BadRequestException } from '@nestjs/common';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export interface MediaVideoProbe {
  format?: { format_name?: string; duration?: string };
  streams?: ProbeStream[];
}

export function parseBrowserCompatibleMp4Probe(probe: MediaVideoProbe) {
  const formats = new Set((probe.format?.format_name ?? '').split(','));
  if (!formats.has('mp4') && !formats.has('mov')) {
    throw new BadRequestException('视频必须使用 MP4 容器。');
  }
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  if (!video || video.codec_name !== 'h264') {
    throw new BadRequestException('MP4 视频必须使用 H.264 编码。');
  }
  if (
    !Number.isInteger(video.width) ||
    !Number.isInteger(video.height) ||
    !video.width ||
    !video.height
  ) {
    throw new BadRequestException('无法读取视频尺寸。');
  }
  if (
    probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name !== 'aac')
  ) {
    throw new BadRequestException('MP4 的音轨必须使用 AAC 编码。');
  }
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new BadRequestException('无法读取视频时长。');
  }
  const sideDataRotation = video.side_data_list?.find((item) =>
    Number.isFinite(item.rotation),
  )?.rotation;
  const tagRotation = Number(video.tags?.rotate ?? 0);
  const rotation = sideDataRotation ?? (Number.isFinite(tagRotation) ? tagRotation : 0);
  const swapsDimensions = Math.abs(rotation) % 180 === 90;
  return {
    width: swapsDimensions ? video.height : video.width,
    height: swapsDimensions ? video.width : video.height,
    durationMs: Math.round(durationSeconds * 1_000),
  };
}
