import { pinyin } from 'pinyin-pro';

const SEARCHABLE_SYLLABLE = /^[a-z0-9]+$/i;

export interface EagleTagPhonetics {
  pinyin: string;
  pinyinInitials: string;
}

export function createEagleTagPhonetics(name: string): EagleTagPhonetics {
  const syllables = pinyin(name.normalize('NFKC').trim(), {
    toneType: 'none',
    type: 'array',
  })
    .map((part) => part.toLocaleLowerCase())
    .filter((part) => SEARCHABLE_SYLLABLE.test(part));

  return {
    pinyin: syllables.join(''),
    pinyinInitials: syllables.map((part) => part.charAt(0)).join(''),
  };
}
