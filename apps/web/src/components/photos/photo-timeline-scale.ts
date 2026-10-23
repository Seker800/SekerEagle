interface TimelineMonth {
  month: string;
  count: number;
}

interface TimelineScale {
  positions: number[];
  years: { year: number; top: number }[];
  breaks: { newerYear: number; olderYear: number; top: number }[];
}

/** Maps the API's newest-first monthly index; never changes dates, counts or cursors. */
export function buildPhotoTimelineScale(months: readonly TimelineMonth[]): TimelineScale {
  const groups: { year: number; indices: number[]; count: number }[] = [];
  for (const [index, item] of months.entries()) {
    const year = Number(item.month.slice(0, 4));
    let group = groups.at(-1);
    if (group?.year !== year) {
      group = { year, indices: [], count: 0 };
      groups.push(group);
    }
    group.indices.push(index);
    group.count += item.count;
  }

  const positions: number[] = [];
  const years: TimelineScale['years'] = [];
  const breaks: TimelineScale['breaks'] = [];
  let offset = 0;
  for (const [index, group] of groups.entries()) {
    const previous = groups[index - 1];
    if (previous && previous.year - group.year > 1) {
      // Empty decades cost the same space as one missing year, with an explicit break.
      const gap = 0.25;
      breaks.push({ newerYear: previous.year, olderYear: group.year, top: offset + gap / 2 });
      offset += gap;
    }
    // A base allocation keeps rare years reachable; a cap prevents busy years dominating.
    const weight = Math.min(4, 1 + Math.log10(Math.max(1, group.count)));
    const firstMonth = Number(months[group.indices[0]].month.slice(5));
    const lastMonth = Number(months[group.indices[group.indices.length - 1]].month.slice(5));
    for (const monthIndex of group.indices) {
      const month = Number(months[monthIndex].month.slice(5));
      const fraction =
        firstMonth === lastMonth ? 0.5 : (firstMonth - month) / (firstMonth - lastMonth);
      positions[monthIndex] = offset + fraction * weight;
    }
    years.push({ year: group.year, top: offset + weight / 2 });
    offset += weight;
  }

  // Trim unused halves of singleton endpoint years; endpoints remain actual photo months.
  const start = positions[0] ?? 0;
  const span = (positions.at(-1) ?? start) - start;
  const normalize = (top: number) => (span > 0 ? ((top - start) / span) * 100 : 0);
  return {
    positions: positions.map(normalize),
    years: years.map(({ year, top }) => ({ year, top: normalize(top) })),
    breaks: breaks.map((gap) => ({ ...gap, top: normalize(gap.top) })),
  };
}
