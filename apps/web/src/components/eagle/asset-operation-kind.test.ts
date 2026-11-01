import i18next from 'i18next';
import { tForLocale } from '../../i18n';
import { expect, it } from 'vitest';
import { ASSET_OPERATION_KINDS } from '@sekereagle/library-core';
import { operationKindPresentation } from './asset-operation-kind';

it('every known operation has explicit titles and membership semantics', () => {
  for (const kind of ASSET_OPERATION_KINDS) {
    const presentation = operationKindPresentation(kind, 'PHOTO');
    expect(presentation.executable).toBe(true);
    expect(presentation.title.length).toBeGreaterThan(0);
  }
  expect(operationKindPresentation('SEND', 'PHOTO').title).toBe('发送到素材');
  expect(operationKindPresentation('SEND', 'MATERIAL').title).toBe('发送到照片');
  expect(operationKindPresentation('TRASH', 'PHOTO').optimisticMembership).toBe('HIDE_ACTIVE');
  expect(operationKindPresentation('RESTORE', 'PHOTO').optimisticMembership).toBe('HIDE_TRASH');
  expect(operationKindPresentation('EMPTY_TRASH', 'PHOTO').optimisticMembership).toBe('NONE');
});
it('unknown persisted kinds display explicit unsupported state and never borrow destructive semantics', () => {
  for (const kind of ['FUTURE_KIND', '__proto__', 'constructor']) {
    const presentation = operationKindPresentation(kind, 'PHOTO');
    expect(presentation.executable).toBe(false);
    expect(presentation.title).toBe('不支持的操作类型');
    expect(presentation.optimisticMembership).toBe('NONE');
    expect(presentation.compensation).toBe(null);
  }
});

it('resolves presentation titles through the active locale at the display boundary', async () => {
  const previous = i18next.language;
  try {
    await i18next.changeLanguage('en-US');
    expect(operationKindPresentation('TRASH', 'PHOTO').title).toBe(
      tForLocale('en-US', '移入回收站'),
    );
    expect(operationKindPresentation('FUTURE_KIND', 'PHOTO').title).toBe(
      tForLocale('en-US', '不支持的操作类型'),
    );
  } finally {
    await i18next.changeLanguage(previous);
  }
});
