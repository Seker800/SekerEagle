import { t, type MessageId } from '../../../i18n';
import {
  WATERMARK_TEMPLATES as templates,
  WATERMARK_CATEGORIES as categories,
} from '@sekereagle/photo-render-core';
export * from '@sekereagle/photo-render-core/photo-watermark-model';
export const WATERMARK_TEMPLATES = templates.map((item) => ({
  ...item,
  label: t(item.label as MessageId),
}));
export const WATERMARK_CATEGORIES = categories.map((item) => ({
  ...item,
  label: t(item.label as MessageId),
}));
