import { colorDistance, rgbToLab } from './eagle-color-search';

export interface EagleRepresentativeColor {
  hex: string;
  weight: number;
  labL: number;
  labA: number;
  labB: number;
}

interface ColorBucket {
  weight: number;
  red: number;
  green: number;
  blue: number;
}

function hexChannel(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function extractRepresentativeColors(
  pixels: Buffer,
  channels: number,
  pixelCount: number,
  limit = 6,
): EagleRepresentativeColor[] {
  if (channels < 3) throw new Error('颜色提取需要 RGB 或 RGBA 像素。');
  const buckets = new Map<number, ColorBucket>();
  let visibleWeight = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * channels;
    const alphaWeight = channels >= 4 ? pixels[offset + 3]! / 255 : 1;
    if (alphaWeight === 0) continue;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const key = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
    const bucket = buckets.get(key) ?? { weight: 0, red: 0, green: 0, blue: 0 };
    bucket.weight += alphaWeight;
    bucket.red += red * alphaWeight;
    bucket.green += green * alphaWeight;
    bucket.blue += blue * alphaWeight;
    buckets.set(key, bucket);
    visibleWeight += alphaWeight;
  }
  if (visibleWeight === 0) return [];

  const clusters: ColorBucket[] = [];
  for (const bucket of [...buckets.values()].sort((left, right) => right.weight - left.weight)) {
    const bucketRgb = {
      red: bucket.red / bucket.weight,
      green: bucket.green / bucket.weight,
      blue: bucket.blue / bucket.weight,
    };
    const nearby = clusters.find(
      (cluster) =>
        colorDistance(
          rgbToLab(bucketRgb.red, bucketRgb.green, bucketRgb.blue),
          rgbToLab(
            cluster.red / cluster.weight,
            cluster.green / cluster.weight,
            cluster.blue / cluster.weight,
          ),
        ) <= 10,
    );
    if (nearby) {
      nearby.weight += bucket.weight;
      nearby.red += bucket.red;
      nearby.green += bucket.green;
      nearby.blue += bucket.blue;
    } else {
      clusters.push({ ...bucket });
    }
  }

  return clusters
    .sort((left, right) => right.weight - left.weight)
    .filter((bucket, index) => index === 0 || bucket.weight / visibleWeight >= 0.03)
    .slice(0, Math.max(1, limit))
    .map((bucket) => {
      const red = Math.round(bucket.red / bucket.weight);
      const green = Math.round(bucket.green / bucket.weight);
      const blue = Math.round(bucket.blue / bucket.weight);
      return {
        hex: `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}`,
        weight: bucket.weight / visibleWeight,
        ...rgbToLab(red, green, blue),
      };
    });
}
