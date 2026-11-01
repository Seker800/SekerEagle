import { BadRequestException, Injectable } from '@nestjs/common';
import { photoStatisticsSql } from './photo-statistics-query';
import { readMemoryStatistics } from './photo-memory-client';
import { PrismaService } from '../prisma/prisma.service';
import type { PhotoStatisticsQueryDto } from './photo-statistics.dto';

type Grain = 'day' | 'week' | 'month' | 'year';
export function statisticsPeriods(first: string | null, last: string | null, grain: Grain) {
  if (!first || !last) return [];
  const date = new Date(`${first.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${last.slice(0, 10)}T00:00:00Z`);
  if (date > end) return [];
  if (grain === 'week') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  } else if (grain !== 'day') {
    date.setUTCDate(1);
    end.setUTCDate(1);
  }
  if (grain === 'year') {
    date.setUTCMonth(0);
    end.setUTCMonth(0);
  }
  const periods: string[] = [];
  while (date <= end) {
    const limit = grain === 'week' ? 10440 : 732;
    if (periods.length === limit)
      throw new BadRequestException(`统计最多显示 ${limit} 个时间段，请缩小日期范围或改用月／年。`);
    periods.push(
      date
        .toISOString()
        .slice(0, grain === 'day' || grain === 'week' ? 10 : grain === 'month' ? 7 : 4),
    );
    if (grain === 'day' || grain === 'week')
      date.setUTCDate(date.getUTCDate() + (grain === 'week' ? 7 : 1));
    else if (grain === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
    else date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return periods;
}
export interface Usage {
  key: string;
  count: number;
}
export interface Summary {
  total: number;
  unknownDate: number;
  first: string | null;
  last: string | null;
  cameras: Usage[];
  lenses: Usage[];
  cameraOptions: string[];
  lensOptions: string[];
  points: Array<{ period: string; key: string | null; count: number }>;
}

/** One snapshot for all charts; daily frequencies avoid repeatedly materializing each photo. */
@Injectable()
export class PhotoStatisticsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(ownerId: string, includePrivate: boolean, query: PhotoStatisticsQueryDto) {
    const grain = query.grain ?? 'month';
    const groupBy = query.groupBy ?? 'camera';
    if (query.start && query.end && query.start > query.end)
      throw new BadRequestException('开始日期不能晚于结束日期。');
    if (query.start && query.end) statisticsPeriods(query.start, query.end, grain);
    const summary =
      (await readMemoryStatistics(ownerId, includePrivate, query)) ??
      (
        await this.prisma.$queryRaw<Summary[]>(photoStatisticsSql(ownerId, includePrivate, query))
      )[0]!;
    return {
      ...summary,
      grain,
      groupBy,
      periods: statisticsPeriods(query.start ?? summary.first, query.end ?? summary.last, grain),
    };
  }
}
