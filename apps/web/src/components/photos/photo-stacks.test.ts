import {describe,it,expect} from 'vitest';
import {collapsePhotoStacks} from './photo-stacks';
import type {EagleAssetListItem, EaglePhotoStack} from '../../lib/eagle-api';
const asset = (id:string) => ({id}) as EagleAssetListItem;
describe('photo stacks', () => {
  it('collapses a group across pages and uses its explicit cover', () => {
    const cover = asset('best');
    const stack = {id:'group',bestAssetId:'best',assetIds:['one','two','best'],cover} as EaglePhotoStack;
    expect(collapsePhotoStacks([asset('one'),asset('other'),asset('two')], [stack]).map(row=>row.id)).toEqual(['best','other']);
  });
  it('never hides an unrelated photo or invents a stack for a single visible member', () => {
    const only = asset('one');
    expect(collapsePhotoStacks([only,asset('other')],[{id:'group',assetIds:['one'],cover:only} as EaglePhotoStack]).map(row=>row.id)).toEqual(['one','other']);
  });
});
