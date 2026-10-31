import {useEffect,useMemo,useRef,useState} from 'react';
import {useInfiniteQuery,useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {IconCopy,IconX,IconCheck,IconZoomIn} from '@tabler/icons-react';
import {useLibraryWorkspace} from '../../lib/library-workspace';
import {createDuplicatesApi,type DuplicateCleanupInput,type DuplicateGroupSummary} from '../../lib/eagle-duplicates-api';
import {MediaLoadScheduler} from '../media/loading/mediaLoadScheduler';
import {EagleAssetThumbnail} from './EagleAssetThumbnail';
import {useAssetOperationList} from './useAssetOperations';
import {getEagleWorkspaceCache} from './eagle-workspace-cache';
import {t} from '../../i18n';
import {EagleImageViewer} from './EagleImageViewer';
import {getEaglePreviewContentUrl} from './eagle-media-sources';
import styles from './EagleDuplicates.module.css';
const bytes=(n:number)=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:n<1024**3?`${(n/1024**2).toFixed(1)} MB`:`${(n/1024**3).toFixed(2)} GB`;
interface Props {includePrivate:boolean;onClose:()=>void}
export function EagleDuplicates({includePrivate,onClose}:Props){
 const {libraryMode,ownerId}=useLibraryWorkspace(),client=useQueryClient();
 const api=useMemo(()=>createDuplicatesApi(libraryMode),[libraryMode]);
 const scheduler=useMemo(()=>new MediaLoadScheduler(),[]);
 const loadService=useMemo(()=>getEagleWorkspaceCache(client,ownerId,libraryMode).thumbnails,[client,ownerId,libraryMode]);
 const [kind,setKind]=useState('ALL'),[showIgnored,setShowIgnored]=useState(false),[expanded,setExpanded]=useState<string|null>(null);
 const [confirm,setConfirm]=useState<{input:DuplicateCleanupInput;count:number;size:number;exact:boolean}|null>(null);
 const [notice,setNotice]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),scanId=useRef<string|null>(null);
 useEffect(()=>{const el=dialog.current,previous=document.activeElement as HTMLElement|null;el?.showModal();return()=>{el?.close();previous?.focus();};},[]);
 const queryKey=['eagle',ownerId,libraryMode,'duplicates',includePrivate,kind,showIgnored];
 const results=useInfiniteQuery({queryKey,initialPageParam:undefined as {cursor:string;revision:string}|undefined,
  queryFn:({pageParam,signal})=>api.list({...pageParam,kind,showIgnored:String(showIgnored)},signal),
  getNextPageParam:last=>last.nextCursor?{cursor:last.nextCursor,revision:last.revision}:undefined,staleTime:30_000,retry:false});
 const data=results.data?.pages[0],groups=results.data?.pages.flatMap(p=>p.groups)??[];
 const operationQueries=useAssetOperationList(includePrivate),operations=operationQueries.flatMap(q=>q.data??[]).filter(op=>op.libraryMode===libraryMode && (op.kind==='DUPLICATE_SCAN'||op.kind==='DUPLICATE_CLEANUP'));
 const active=operations.filter(op=>op.running||op.queued),scanning=active.some(op=>op.kind==='DUPLICATE_SCAN');
 const previousActive=useRef('');
 useEffect(()=>{
  const key=active.map(op=>op.id).sort().join(':');
  if(previousActive.current && previousActive.current!==key){setNotice(t('后台处理状态已更新，刷新即可查看最新结果。'));}
  previousActive.current=key;
 },[active]);
 const invalidate=()=>client.invalidateQueries({queryKey:['eagle',ownerId,libraryMode,'operations']});
 const scan=useMutation({mutationFn:()=>{scanId.current??=crypto.randomUUID();return api.scan(scanId.current);},onSuccess:result=>{scanId.current=null;setNotice(result.operationId?t('检查已加入后台任务，关闭此窗口后仍会继续。'):t('现有可用图片都已检查，新图片处理完成后可再次检查。'));void invalidate();}});
 const cleanup=useMutation({mutationFn:(input:DuplicateCleanupInput)=>api.cleanup(input),onSuccess:result=>{setConfirm(null);setExpanded(null);setNotice(result.operationId?t('清理已加入后台任务，可在任务中心查看进度。完成后可从回收站恢复。'):t('没有需要清理的项目。'));void invalidate();}});
 const refresh=async()=>{setExpanded(null);await client.resetQueries({queryKey,exact:true});setNotice('');};
 const confirmAll=()=>{if(!data)return;setConfirm({input:{operationId:crypto.randomUUID(),allExact:true,revision:data.revision},count:data.exactGroups,size:data.removableBytes,exact:true});};
 return <dialog ref={dialog} className={styles.dialog} aria-label={t('查重清理')} onCancel={event=>{event.preventDefault();if(confirm&&!cleanup.isPending)setConfirm(null);else onClose();}}>
  <header className={styles.header}><div><h2><IconCopy size={21}/>{t('查重清理')}</h2><p>{libraryMode==='PHOTO'?t('照片库'):t('素材库')} · {t('只检查当前可见内容')}</p></div><button type="button" aria-label={t('关闭查重清理')} onClick={onClose}><IconX size={21}/></button></header>
  {confirm?<section className={styles.confirm} role="alertdialog" aria-label={t('确认清理')}>
   <h3>{confirm.input.allExact?t('清理 {{count}} 组完全重复项',{count:confirm.count}):t('清理 {{count}} 项',{count:confirm.count})}</h3>
   <p>{t('每组保留已选择的内容，其余项目移入回收站，可以恢复。')}</p>
   <p>{confirm.exact?t('完全重复项的独有标签和最高评分会合并到保留项。说明、来源和编辑关系仍保存在原项目中，请先检查需要保留的信息。'):t('画面近似不能证明文件重复。请确认已比较清晰度、构图、表情以及原片与成片。')}</p>
   <p>{t('现在不会释放磁盘空间，清空回收站后才会释放实际占用。')}</p>
   {cleanup.error&&<p role="alert">{cleanup.error.message}</p>}
   <div className={styles.actions}><button type="button" disabled={cleanup.isPending} onClick={()=>setConfirm(null)}>{t('返回检查')}</button><button className={styles.danger} type="button" disabled={cleanup.isPending} onClick={()=>cleanup.mutate(confirm.input)}>{cleanup.isPending?t('正在提交…'):t('确认移入回收站')}</button></div>
  </section>:<>
  <div className={styles.tools}>
   <div className={styles.tabs} role="group" aria-label={t('查重类型')}>{[['ALL',t('全部')],['EXACT',t('完全重复')],['SIMILAR',t('画面近似')]].map(([value,label])=><button key={value} type="button" aria-pressed={kind===value} onClick={()=>{setKind(value!);setExpanded(null);}}>{label}{data&&value==='EXACT'?` ${data.exactGroups}`:data&&value==='SIMILAR'?` ${data.similarGroups}`:''}</button>)}</div>
   <div className={styles.actions}><button type="button" disabled={scan.isPending||scanning} onClick={()=>scan.mutate()}>{scanning?t('后台检查中…'):t('检查新内容')}</button><button type="button" onClick={()=>void refresh()} disabled={results.isFetching}>{t('刷新结果')}</button></div>
  </div>
  <div className={styles.content}>
   {data&&<div className={styles.coverage}><strong>{t('{{count}} 组待检查',{count:data.totalGroups})}</strong><span>{t('视觉检查 {{done}} / {{total}} 张',{done:data.coverage.indexed.toLocaleString(),total:data.coverage.total.toLocaleString()})}{data.coverage.waiting>0?` · ${t('{{count}} 张等待预览',{count:data.coverage.waiting})}`:''}</span><p>{t('完全重复依据文件内容；画面近似依据像素特征，需要人工确认。未完成视觉检查不代表没有重复。')}</p></div>}
   {active.map(op=><div key={op.id} className={styles.progress} role="status">{op.kind==='DUPLICATE_SCAN'?t('检查图片'):t('清理重复项')} · {op.completed.toLocaleString()} / {op.total.toLocaleString()} {op.running?t('正在处理'):t('排队中')}</div>)}
   {operations.filter(op=>op.failed>0).map(op=><p key={op.id} className={styles.warning}>{t('{{count}} 项未完成，可在任务中心查看原因并重试。',{count:op.failed})}</p>)}
   {notice&&<p role="status" className={styles.notice}>{notice}</p>}
   {(scan.error||results.error)&&<div role="alert"><p>{(scan.error??results.error)?.message}</p><button type="button" onClick={()=>void refresh()}>{t('重试')}</button></div>}
   {results.isPending&&<p role="status">{t('正在读取查重结果…')}</p>}
   {data&&<div className={styles.resultTools}><label><input type="checkbox" checked={showIgnored} onChange={event=>{setShowIgnored(event.target.checked);setExpanded(null);}}/>{t('查看已忽略')} ({data.ignoredGroups})</label>{!showIgnored&&data.exactGroups>0&&<button type="button" disabled={!!active.some(op=>op.kind==='DUPLICATE_CLEANUP')} onClick={confirmAll}>{t('清理全部完全重复项')}</button>}</div>}
   {groups.map((group,index)=><article key={group.signature} className={styles.group}>
    <button className={styles.groupHeader} type="button" aria-expanded={expanded===group.signature} onClick={()=>setExpanded(current=>current===group.signature?null:group.signature)}>
     <div className={styles.previews}>{group.previews.map((asset,i)=><div key={asset.id}><EagleAssetThumbnail asset={asset} scheduler={scheduler} loadService={loadService} order={index*2+i} displayWidth={92}/></div>)}</div>
     <div><strong>{group.kind==='EXACT'?t('文件完全相同'):t('画面近似，待确认')} · {group.count} {t('项')}</strong><p>{group.previews[0]?.displayName}</p><small>{t('保留一项后可清理 {{size}} 文件',{size:bytes(group.removableBytes)})}</small></div><span>{expanded===group.signature?t('收起'):t('比较并选择')}</span>
    </button>
    {expanded===group.signature&&<DuplicateComparison key={group.signature} group={group} ignored={showIgnored} api={api} scheduler={scheduler} onIgnored={()=>{setExpanded(null);void refresh();}} onCleanup={(keepIds,count,size)=>setConfirm({input:{operationId:crypto.randomUUID(),groups:[{signature:group.signature,keepIds}]},count,size,exact:group.kind==='EXACT'})}/>}
   </article>)}
   {data&&!groups.length&&!results.error&&<div className={styles.empty}><IconCheck size={35}/><h3>{showIgnored?t('没有已忽略的结果'):t('当前没有待处理的查重结果')}</h3><p>{data.coverage.indexed<data.coverage.total?t('还有图片未完成视觉检查，可以点击“检查新内容”。'):t('新图片入库后，可以再次检查。')}</p></div>}
   {results.hasNextPage&&<button type="button" disabled={results.isFetchingNextPage} onClick={()=>void results.fetchNextPage()}>{results.isFetchingNextPage?t('正在加载…'):t('加载更多组')}</button>}
  </div></>}
 </dialog>;
}
function DuplicateComparison({group,ignored,api,scheduler,onIgnored,onCleanup}:{group:DuplicateGroupSummary;ignored:boolean;api:ReturnType<typeof createDuplicatesApi>;scheduler:MediaLoadScheduler;onIgnored:()=>void;onCleanup:(keepIds:string[],count:number,size:number)=>void}){
 const {ownerId,libraryMode,api:workspaceApi}=useLibraryWorkspace();
 const [previewIndex,setPreviewIndex]=useState<number|null>(null);
 const [keepIds,setKeepIds]=useState([group.recommendedId]);
 const members=useInfiniteQuery({queryKey:['eagle',ownerId,libraryMode,'duplicate-members',group.signature],initialPageParam:undefined as string|undefined,queryFn:({pageParam,signal})=>api.members(group.signature,pageParam,signal),getNextPageParam:last=>last.nextCursor??undefined,retry:false});
 const ignore=useMutation({mutationFn:()=>api.ignore(group.signature,!ignored),onSuccess:onIgnored});
 const items=members.data?.pages.flatMap(p=>p.items)??[],selected=items.filter(item=>!keepIds.includes(item.id));
 const removeCount=group.count-keepIds.length;
 const preview=previewIndex===null?undefined:items[previewIndex];
 const descriptor=useQuery({queryKey:['eagle',ownerId,libraryMode,'duplicate-pyramid',preview?.id,preview?.mediaRevision],enabled:!!preview,queryFn:({signal})=>workspaceApi.getEaglePyramidDescriptor('',preview!.id,signal),retry:false});
 const previewUrl=preview?getEaglePreviewContentUrl(preview):null;
 return <div className={styles.comparison}>
  <p>{group.kind==='EXACT'?t('推荐优先保留有评分的项目，其次为尺寸、文件大小和较早入库时间。可自行更改保留项。'):t('这些图片可能是压缩副本，也可能是连拍或编辑版本。可保留多张；点“放大比较”检查细节。')}</p>
  {members.isPending&&<p role="status">{t('正在读取组内图片…')}</p>}
  {(members.error||ignore.error)&&<p role="alert">{(members.error??ignore.error)?.message}<button type="button" onClick={()=>void members.refetch()}>{t('重试')}</button></p>}
  <div className={styles.members}>{items.map((item,index)=><article key={item.id} className={`${styles.member} ${keepIds.includes(item.id)?styles.kept:''}`}>
   <div className={styles.image}><EagleAssetThumbnail asset={item} scheduler={scheduler} order={index} displayWidth={320}/></div>
   <div className={styles.memberBody}><label><input type="checkbox" checked={keepIds.includes(item.id)} onChange={event=>setKeepIds(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>{keepIds.includes(item.id)?t('保留'):t('移入回收站')}{item.id===group.recommendedId&&<small>{t('推荐保留')}</small>}</label>
   <strong title={item.displayName}>{item.displayName}</strong><span>{item.format.toUpperCase()} · {item.width??'—'} × {item.height??'—'} · {bytes(item.byteSize)}</span><span>{t('入库')} {new Date(item.libraryAddedAt).toLocaleDateString()} {item.rating?`· ${'★'.repeat(item.rating)}`:''}</span>
   {item.photoMetadata?.capturedAt&&<span>{t('拍摄')} {new Date(item.photoMetadata.capturedAt).toLocaleString()}</span>}
   {item.manualTags.length>0&&<span>{t('标签')}：{item.manualTags.map(tag=>tag.name).join('、')}</span>}
   {item.editedCopy&&<span className={styles.warning}>{t('编辑成片，请保留需要的版本')}</span>}{item.livePhoto&&<span className={styles.warning}>{t('实况照片，清理包含关联动态组件')}</span>}
   {item.annotation?.description&&<p>{t('说明')}：{item.annotation.description}</p>}{item.annotation?.sourceUrl&&<p>{t('来源')}：{item.annotation.sourceUrl}</p>}
   <button type="button" onClick={()=>setPreviewIndex(index)}><IconZoomIn size={16}/>{t('放大比较')}</button></div>
  </article>)}</div>
  {members.hasNextPage&&<button type="button" disabled={members.isFetchingNextPage} onClick={()=>void members.fetchNextPage()}>{t('加载更多组内图片')}</button>}
  <div className={styles.actions}><button type="button" disabled={ignore.isPending} onClick={()=>ignore.mutate()}>{ignored?t('重新检查这组'):t('忽略这组')}</button>{!ignored&&<button type="button" className={styles.danger} disabled={!keepIds.length||removeCount===0||!members.data||!!members.error} onClick={()=>onCleanup(keepIds,removeCount,selected.reduce((n,item)=>n+item.byteSize,0))}>{t('保留 {{keep}} 项，清理 {{remove}} 项',{keep:keepIds.length,remove:removeCount})}</button>}</div>
  {!keepIds.length&&<p role="alert">{t('每组至少保留一项。')}</p>}
  {preview&&previewUrl&&<EagleImageViewer asset={preview} readOnly image={{src:previewUrl,alt:preview.displayName,assetId:preview.id}} descriptor={descriptor.data??undefined} onClose={()=>setPreviewIndex(null)} subtitle={t('查重比较 · {{value1}} × {{value2}}',{value1:preview.width??'—',value2:preview.height??'—'})} navigation={{previous:previewIndex!>0?()=>setPreviewIndex(previewIndex!-1):undefined,next:previewIndex!<items.length-1?()=>setPreviewIndex(previewIndex!+1):undefined,position:{current:previewIndex!+1,total:items.length}}}/>}
 </div>;
}
