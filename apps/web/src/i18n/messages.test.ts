import { describe, expect, it } from 'vitest';
import { enUS } from './messages/en-US';
import { zhCN } from './messages/zh-CN';

const placeholders = (message: string) =>
  [...message.matchAll(/{{\s*([^},]+).*?}}/g)].map((m) => m[1]);

describe('translation catalogs', () => {
  it('keeps Chinese and English message identifiers in exact parity', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('provides English copy for every message instead of leaking Chinese UI text', () => {
    const untranslated = Object.entries(enUS).filter(
      ([id, value]) => /[\u3400-\u9fff]/u.test(value) || value === id,
    );
    expect(untranslated).toEqual([]);
  });

  it('preserves interpolation variables across locales', () => {
    for (const id of Object.keys(zhCN) as Array<keyof typeof zhCN>) {
      expect(placeholders(enUS[id]).sort(), id).toEqual(placeholders(zhCN[id]).sort());
    }
  });

  it('contains the primary English application journey', () => {
    expect(enUS['正在连接 SekerEagle…']).toBe('Connecting to SekerEagle…');
    expect(enUS['登录素材库']).toBe('Sign in to your library');
    expect(enUS['素材']).toBe('Assets');
    expect(enUS['智能文件夹']).toBe('Smart folders');
    expect(enUS['个人账号']).toBe('Account');
  });
});
