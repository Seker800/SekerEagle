import { request } from './api-client';
export interface PhotoStatisticsQuery {
  grain: 'day' | 'week' | 'month' | 'year';
  groupBy: 'total' | 'camera' | 'lens';
  start?: string;
  end?: string;
  cameras: string[];
  lenses: string[];
}
export interface PhotoUsage {
  key: string;
  count: number;
}
export interface PhotoStatisticsData {
  total: number;
  unknownDate: number;
  grain: PhotoStatisticsQuery['grain'];
  groupBy: PhotoStatisticsQuery['groupBy'];
  periods: string[];
  cameras: PhotoUsage[];
  lenses: PhotoUsage[];
  cameraOptions: string[];
  lensOptions: string[];
  points: Array<{ period: string; key: string | null; count: number }>;
}
export function getPhotoStatistics(input: PhotoStatisticsQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ grain: input.grain, groupBy: input.groupBy });
  if (input.start) params.set('start', input.start);
  if (input.end) params.set('end', input.end);
  for (const key of ['cameras', 'lenses'] as const)
    for (const value of input[key]) params.append(key, value);
  return request<PhotoStatisticsData>(`/api/photos/photography/statistics?${params}`, { signal });
}
