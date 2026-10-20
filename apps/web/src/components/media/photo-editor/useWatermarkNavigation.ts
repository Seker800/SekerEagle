import { useToolGroupNavigation } from './useToolGroupNavigation';
import {
  findWatermark,
  WATERMARK_CATEGORIES,
  WATERMARK_TEMPLATES,
  type WatermarkCategory,
} from './photo-watermark-model';

// Keep every category contiguous even if the source catalog is later reordered.
export const ORDERED_WATERMARK_TEMPLATES = WATERMARK_CATEGORIES.flatMap((category) =>
  WATERMARK_TEMPLATES.filter((template) => template.category === category.id),
);

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
