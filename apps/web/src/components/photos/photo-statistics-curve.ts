/** Cubic Hermite interpolation with conservative slopes: no invented extrema between buckets. */
export function smoothStatisticsPath(points: readonly (readonly [number, number])[]): string {
  if (!points.length) return '';
  const format = (value: number) => String(Number(value.toFixed(3)));
  const first = points[0];
  let path = `M ${format(first[0])} ${format(first[1])}`;
  if (points.length === 1) return path;
  const secants = points
    .slice(1)
    .map((point, index) => (point[1] - points[index][1]) / (point[0] - points[index][0]));
  const slopes = points.map((_, index) => {
    if (index === 0) return secants[0];
    if (index === points.length - 1) return secants[index - 1];
    const before = secants[index - 1],
      after = secants[index];
    return before * after <= 0
      ? 0
      : Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
  });
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1],
      current = points[index];
    const step = (current[0] - previous[0]) / 3;
    path += ` C ${[previous[0] + step, previous[1] + slopes[index - 1] * step, current[0] - step, current[1] - slopes[index] * step, ...current].map(format).join(' ')}`;
  }
  return path;
}
