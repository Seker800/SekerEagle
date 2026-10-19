/** Serializable numeric keys shared by UI, history, worker and export. No UI dependencies. */
export const HSL_BANDS = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Aqua',
  'Blue',
  'Purple',
  'Magenta',
] as const;
export const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300] as const;
export const HSL_AXES = ['Hue', 'Saturation', 'Luminance'] as const;
export const CURVE_CHANNELS = ['Master', 'Red', 'Green', 'Blue'] as const;
export const CURVE_POINTS = [0, 1, 2, 3, 4] as const;
export const GRADE_ZONES = ['Shadows', 'Midtones', 'Highlights'] as const;
export type HslBand = (typeof HSL_BANDS)[number];
export type ColorAxis = (typeof HSL_AXES)[number];
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
export type CurvePoint = (typeof CURVE_POINTS)[number];
export type GradeZone = (typeof GRADE_ZONES)[number];
export type HslKey = `hsl${HslBand}${ColorAxis}`;
export type CurveKey = `curve${CurveChannel}${CurvePoint}`;
export type GradeKey = `grade${GradeZone}${ColorAxis}` | 'gradeBalance';
export type AdvancedKey = HslKey | CurveKey | GradeKey;
export const hslKey = (band: HslBand, axis: ColorAxis): HslKey => `hsl${band}${axis}`;
export const curveKey = (channel: CurveChannel, point: CurvePoint): CurveKey =>
  `curve${channel}${point}`;
export const gradeKey = (zone: GradeZone, axis: ColorAxis): GradeKey => `grade${zone}${axis}`;
const keys: AdvancedKey[] = [
  ...HSL_BANDS.flatMap((band) => HSL_AXES.map((axis) => hslKey(band, axis))),
  ...CURVE_CHANNELS.flatMap((channel) => CURVE_POINTS.map((point) => curveKey(channel, point))),
  ...GRADE_ZONES.flatMap((zone) => HSL_AXES.map((axis) => gradeKey(zone, axis))),
  'gradeBalance',
];
export const DEFAULT_ADVANCED_EDITS = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
  AdvancedKey,
  number
>;
