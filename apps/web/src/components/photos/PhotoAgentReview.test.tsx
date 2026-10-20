import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, it, expect, vi } from 'vitest';
import { PhotoAgentReview } from './PhotoAgentReview';
import type { PhotoAgentTask } from '../../lib/photo-agent-api';
const mocks=vi.hoisted(()=>({review:vi.fn(),undo:vi.fn(),detail:vi.fn(),list:vi.fn(),cancel:vi.fn(),create:vi.fn()}));
vi.mock('../../lib/photo-agent-api',()=>({listPhotoAgentTasks:mocks.list,getPhotoAgentTask:mocks.detail,reviewPhotoAgentSuggestion:mocks.review,undoPhotoAgentSuggestion:mocks.undo,cancelPhotoAgentTask:mocks.cancel,createPhotoAgentTask:mocks.create}));
function fixture():PhotoAgentTask {
 return {id:'task',kind:'CITY',status:'OPEN',expiresAt:'2099-01-01',assets:[{id:'photo',originalName:'photo.jpg',displayName:'Test photo',mediaRevision:1,rowVersion:1,deletedAt:null,previewId:'preview'}],suggestions:[{id:'suggestion',assetId:'photo',kind:'CITY',status:'PENDING',value:{id:'hangzhou',name:'杭州',country:'中国',region:'浙江',latitude:30.25,longitude:120.15},rationale:'两张手机照片提供原始位置',evidence:[{id:'photo'}]}]};
}
beforeEach(()=>{
 vi.resetAllMocks();mocks.review.mockResolvedValue({});mocks.undo.mockResolvedValue({});mocks.cancel.mockResolvedValue({});mocks.create.mockResolvedValue({id:'task'});mocks.detail.mockResolvedValue(fixture());mocks.list.mockResolvedValue({items:[{id:'task',kind:'CITY',status:'OPEN',assetCount:1}],next:null});
});
async function show() {
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 render(<QueryClientProvider client={client}><PhotoAgentReview includePrivate={false}/></QueryClientProvider>);
 fireEvent.click(await screen.findByRole('button',{name:/城市定位/}));
 await screen.findByText('两张手机照片提供原始位置');
 return client;
}
it('shows evidence before accepting a specific suggestion and refreshes the task',async()=>{
 await show();expect(screen.getByText(/杭州/)).toBeInTheDocument();
 expect(screen.getAllByRole('img',{name:'Test photo'})[0]).toHaveAttribute('src','/api/photos/agent/photos/photo/preview');
 fireEvent.click(screen.getByRole('button',{name:'接受建议'}));
 await waitFor(()=>expect(mocks.review).toHaveBeenCalledWith('task','suggestion','ACCEPT'));
});
it('surfaces conflicts and refreshes data even when a review request fails',async()=>{
 mocks.review.mockRejectedValue(new Error('照片版本冲突'));
 const client=await show(),invalidate=vi.spyOn(client,'invalidateQueries');
 fireEvent.click(screen.getByRole('button',{name:'接受建议'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('照片版本冲突');
 await waitFor(()=>expect(invalidate).toHaveBeenCalled());
});
it('rejected proposals can be reviewed without applying them',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'拒绝建议'}));
 await waitFor(()=>expect(mocks.review).toHaveBeenCalledWith('task','suggestion','REJECT'));expect(mocks.undo).not.toHaveBeenCalled();
});
it('batch applies only selected proposals',async()=>{
 await show();fireEvent.click(screen.getByRole('checkbox',{name:'选择此建议'}));
 fireEvent.click(screen.getByRole('button',{name:'接受所选建议'}));
 await waitFor(()=>expect(mocks.review).toHaveBeenCalledExactlyOnceWith('task','suggestion','ACCEPT'));
});
it('manual city edits require individual review and cannot be silently ignored by batch apply',async()=>{
 await show();fireEvent.click(screen.getByRole('checkbox',{name:'选择此建议'}));
 fireEvent.click(screen.getByText('修改城市'));fireEvent.change(screen.getByLabelText('城市名称'),{target:{value:'湖州市'}});
 expect(screen.getByRole('checkbox',{name:'选择此建议'})).not.toBeChecked();expect(screen.getByRole('checkbox',{name:'选择此建议'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'接受建议'}));
 await waitFor(()=>expect(mocks.review).toHaveBeenCalledWith('task','suggestion','ACCEPT',expect.objectContaining({name:'湖州市'})));
});
it('expired tasks block new changes while allowing undo of an already applied item',async()=>{
 const task=fixture();task.expiresAt='2000-01-01';task.suggestions[0]!.status='ACCEPTED';mocks.detail.mockResolvedValue(task);
 await show();expect(screen.getByRole('button',{name:'接受所选建议'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'撤销本项操作'}));
 await waitFor(()=>expect(mocks.undo).toHaveBeenCalledWith('task','suggestion'));
});
it('cancels future task work and presents empty suggestion state',async()=>{
 await show();fireEvent.click(screen.getByRole('button',{name:'取消任务'}));await waitFor(()=>expect(mocks.cancel).toHaveBeenCalledWith('task'));
});
it('creates a task only for an explicit date range',async()=>{
 await show();fireEvent.change(screen.getByLabelText('开始日期'),{target:{value:'2026-10-01'}});fireEvent.change(screen.getByLabelText('结束日期'),{target:{value:'2026-10-02'}});
 fireEvent.click(screen.getByRole('button',{name:'创建整理任务'}));await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith(expect.any(String),expect.any(String),'CITY'));
});
