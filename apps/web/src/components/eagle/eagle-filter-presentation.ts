import {
  getEagleFilterFieldDefinition,
  getEagleFilterFields,
  type EagleFilterField,
  type EagleFilterOperator,
} from '@sekereagle/eagle-filter-core';
import { t } from '../../i18n';
import { fields, operators, options, units } from '../../i18n/messages/filter-labels';

export const getOperatorLabel = (operator: EagleFilterOperator) => t(operators[operator]);
export function getFilterPresentation(field: EagleFilterField) {
  const definition = getEagleFilterFieldDefinition(field);
  return {
    ...definition,
    label: t(fields[field]),
    options: definition.options?.map((option) => ({
      ...option,
      label:
        field === 'RATING'
          ? option.value === '0'
            ? t('未评分')
            : t('{{value1}} 星', { value1: option.value })
          : options[option.value]
            ? t(options[option.value])
            : option.value.toUpperCase(),
    })),
    units: definition.units?.map((unit) => ({
      ...unit,
      label: units[unit.value] ? t(units[unit.value]) : unit.value,
    })),
  };
}
export function getFilterPresentations(mode: 'MATERIAL' | 'PHOTO') {
  return getEagleFilterFields(mode).map(({ field }) => getFilterPresentation(field));
}
