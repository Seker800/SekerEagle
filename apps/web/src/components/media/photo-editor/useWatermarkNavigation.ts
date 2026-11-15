import { useToolGroupNavigation } from './useToolGroupNavigation';
import {
  findWatermark,
  WATERMARK_CATEGORIES,
  WATERMARK_TEMPLATES,
  type WatermarkCategory,
} from './photo-watermark-model';

// The two primary layouts lead the strip; category tabs remain shortcuts to the
// first item of each category even when the catalog order is curated.
const templates = WATERMARK_CATEGORIES.flatMap((category) =>
  WATERMARK_TEMPLATES.filter((template) => template.category === category.id),
);
const leading = ['photo-strip', 'photo-side'];
export const ORDERED_WATERMARK_TEMPLATES = [
  ...leading.flatMap((id) => templates.filter((template) => template.id === id)),
  ...templates.filter((template) => !leading.includes(template.id)),
];

const items = [
  { id: 'none', group: 'landscape', anchor: false },
  ...ORDERED_WATERMARK_TEMPLATES.map((template) => ({ id: template.id, group: template.category })),
];
/** Watermark metadata adapts the shared continuous-strip navigation. */
export function useWatermarkNavigation(watermark: string) {
  const navigation = useToolGroupNavigation(items, findWatermark(watermark)?.id ?? 'none');
  return {
    ...navigation,
    group: navigation.group as WatermarkCategory,
    templateRef: navigation.itemRef,
    selectCategory: navigation.selectGroup,
  };
}
