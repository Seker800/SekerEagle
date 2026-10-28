import { BadRequestException } from '@nestjs/common';
import type { MapViewportDto } from './photo-map.dto';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const column = (longitude: number, n: number) =>
  clamp(Math.floor(((longitude + 180) / 360) * n), 0, n - 1);
const row = (latitude: number, n: number) => {
  const lat = (clamp(latitude, -85.05112878, 85.05112878) * Math.PI) / 180;
  return clamp(Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n), 0, n - 1);
};
export function mapGrid(view: MapViewportDto, maximumLevel = 21) {
  if (
    !Object.values(view).every(Number.isFinite) ||
    view.south >= view.north ||
    view.west < -180 ||
    view.west > 180 ||
    view.east < -180 ||
    view.east > 180 ||
    view.south < -90 ||
    view.north > 90 ||
    !Number.isInteger(view.zoom) ||
    view.zoom < 1 ||
    view.zoom > 16
  )
    throw new BadRequestException('地图范围无效');
  let level = Math.min(view.zoom + 5, maximumLevel);
  while (true) {
    const n = 2 ** level,
      west = column(view.west, n),
      east = column(view.east, n);
    const yMin = row(view.north, n),
      yMax = row(view.south, n);
    const xRanges =
      view.west <= view.east
        ? [[west, east]]
        : [
            [west, n - 1],
            [0, east],
          ];
    const cellCount =
      xRanges.reduce((sum, [min, max]) => sum + max! - min! + 1, 0) * (yMax - yMin + 1);
    if (cellCount <= 16384) return { level, n, xRanges, yMin, yMax, cellCount };
    level--;
  }
}
export function decodeMapCell(key: string) {
  let snapshotId: string | undefined;
  if (key.includes(':')) {
    [snapshotId, key] = key.split(':') as [string, string];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId))
      throw new BadRequestException('位置分组无效');
  }
  if (!/^\d{1,2}\/\d{1,7}\/\d{1,7}$/.test(key)) throw new BadRequestException('位置分组无效');
  const [level, x, y] = key.split('/').map(Number) as [number, number, number];
  const n = 2 ** level;
  if (level > 21 || x >= n || y >= n) throw new BadRequestException('位置分组无效');
  return { level, n, x, y, ...(snapshotId ? { snapshotId } : {}) };
}
interface CursorScope {
  ownerId: string;
  includePrivate: boolean;
  cell: string;
}
interface Position {
  id: string;
  at: Date;
}
export function mapCursor(scope: CursorScope, position: Position) {
  return Buffer.from(
    JSON.stringify({
      ...scope,
      mode: 'PHOTO',
      version: 1,
      id: position.id,
      at: position.at.toISOString(),
    }),
  ).toString('base64url');
}
export function readMapCursor(value: string, scope: CursorScope): Position {
  try {
    if (value.length > 2048) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    if (
      decoded.version !== 1 ||
      decoded.mode !== 'PHOTO' ||
      decoded.ownerId !== scope.ownerId ||
      decoded.includePrivate !== scope.includePrivate ||
      decoded.cell !== scope.cell ||
      typeof decoded.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(decoded.id) ||
      typeof decoded.at !== 'string'
    )
      throw new Error();
    const at = new Date(decoded.at);
    if (!Number.isFinite(at.getTime())) throw new Error();
    return { id: decoded.id, at };
  } catch {
    throw new BadRequestException('位置照片游标无效');
  }
}
