export type StatisticsRange = 'all' | 1 | 3 | 5;
const calendarDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Use the viewer's local calendar day, clamping leap day when subtracting calendar years. */
export function statisticsDateRange(range: StatisticsRange, today = new Date()) {
  if (range === 'all') return { start: '', end: '' };
  const start = new Date(today.getFullYear() - range, today.getMonth(), 1, 12);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12).getDate();
  start.setDate(Math.min(today.getDate(), lastDay));
  return { start: calendarDate(start), end: calendarDate(today) };
}
