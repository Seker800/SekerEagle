import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {it,expect,vi} from 'vitest';
import {PhotoAgentReview} from './PhotoAgentReview';
const mocks=vi.hoisted(()=>({review:vi.fn(async()=>({})),undo:vi.fn(async()=>({})),detail:vi.fn(async()=>({id:'task',kind:'CITY',status:'OPEN',expiresAt:'2099-01-01',assets:[{id:'photo',displayName:'Test photo',mediaRevision:1,rowVersion:1,deletedAt:null}],suggestions:[{id:'suggestion',assetId:'photo',kind:'CITY',status:'PENDING',value:{name:'杭州',country:'中国',region:'浙江'},rationale:'两张手机照片提供原始位置',evidence:[{id:'photo'}]}]}))}));
vi.mock('../../lib/photo-agent-api',()=>({listPhotoAgentTasks:async()=>({items:[{id:'task',kind:'CITY',status:'OPEN',assetCount:1}],next:null}),getPhotoAgentTask:mocks.detail,reviewPhotoAgentSuggestion:mocks.review,undoPhotoAgentSuggestion:mocks.undo,cancelPhotoAgentTask:async()=>({})}));
it('shows evidence before accepting a specific suggestion and refreshes the task',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><PhotoAgentReview includePrivate={false}/></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:/城市定位/}));
  expect(await screen.findByText('两张手机照片提供原始位置')).toBeInTheDocument();
  expect(screen.getByText(/杭州/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'接受建议'}));
  await waitFor(()=>expect(mocks.review).toHaveBeenCalledWith('task','suggestion','ACCEPT'));
});
