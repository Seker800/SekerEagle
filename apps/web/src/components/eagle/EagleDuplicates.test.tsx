import {beforeEach, describe, expect, it, vi} from 'vitest';
import {screen, fireEvent, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderInWorkspace} from '../../test/render-in-workspace';
import {EagleDuplicates} from './EagleDuplicates';
const mocks=vi.hoisted(()=>({list:vi.fn(),members:vi.fn(),scan:vi.fn(),cleanup:vi.fn(),ignore:vi.fn()}));
vi.mock('../../lib/eagle-duplicates-api',()=>({createDuplicatesApi:()=>mocks}));
vi.mock('./useAssetOperations',()=>({useAssetOperationList:()=>[{data:[]},{data:[]}]}));
vi.mock('./EagleAssetThumbnail',()=>({EagleAssetThumbnail:()=> <span>图片预览</span>}));
const group={signature:'a'.repeat(64),kind:'EXACT',recommendedId:'one',count:2,removableBytes:1024,previews:[]};
function render(){return renderInWorkspace(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><EagleDuplicates includePrivate={false} onClose={()=>{}} onOpen={()=>{}} /></QueryClientProvider>);}
describe('duplicate cleanup review',()=>{
 beforeEach(()=>{
  vi.clearAllMocks(); HTMLDialogElement.prototype.showModal=vi.fn();HTMLDialogElement.prototype.close=vi.fn();
  mocks.list.mockResolvedValue({revision:'b'.repeat(64),coverage:{total:60000,indexed:100,waiting:5},totalGroups:1,exactGroups:1,similarGroups:0,ignoredGroups:0,removableBytes:1024,nextCursor:null,groups:[group]});
  mocks.scan.mockResolvedValue({operationId:'scan'});mocks.cleanup.mockResolvedValue({operationId:'cleanup'});
 });
 it('shows incomplete indexing honestly and starts a durable incremental scan',async()=>{
  render();await screen.findByText('完全重复');
  expect(screen.getByText(/100.*60,000/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'检查新内容'}));
  await waitFor(()=>expect(mocks.scan).toHaveBeenCalledTimes(1));
 });
 it('requires a concrete review before cleaning all exact duplicates and keeps the same retry identity',async()=>{
  render();await screen.findByText('完全重复');
  fireEvent.click(screen.getByRole('button',{name:'清理全部完全重复项'}));
  expect(mocks.cleanup).not.toHaveBeenCalled();
  expect(screen.getByText(/回收站/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'确认移入回收站'}));
  await waitFor(()=>expect(mocks.cleanup).toHaveBeenCalledWith(expect.objectContaining({allExact:true,revision:'b'.repeat(64),operationId:expect.any(String)})));
 });
 it('reports read failures and permits retry without presenting an empty clean library',async()=>{
  mocks.list.mockRejectedValueOnce(new Error('连接失败'));render();
  expect(await screen.findByRole('alert')).toHaveTextContent('连接失败');
  fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('完全重复');
 });
});
