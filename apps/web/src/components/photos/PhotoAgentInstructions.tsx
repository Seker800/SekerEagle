import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '../../i18n';
import { getPhotoAgentInstructions, savePhotoAgentInstructions } from '../../lib/photo-agent-api';
import styles from './PhotoAgentReview.module.css';

export function PhotoAgentInstructions({ownerId}: {ownerId: string}) {
  const client = useQueryClient();
  const key = ['eagle', ownerId, 'PHOTO', 'agent', 'instructions'];
  const query = useQuery({queryKey:key,queryFn:({signal})=>getPhotoAgentInstructions(signal),staleTime:Infinity,refetchOnWindowFocus:false});
  const [draft,setDraft] = useState<{instructions:string;revision:number}|null>(null);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  async function save() {
    if(!draft || !query.data || saving) return;
    setSaving(true);setError('');setMessage('');
    try {
      const saved = await savePhotoAgentInstructions(draft);
      client.setQueryData(key,saved);setDraft(null);setMessage(t('整理要求已保存'));
    } catch(reason) {setError(reason instanceof Error?reason.message:t('保存失败，请重试。'));}
    finally {setSaving(false);}
  }
  return <section className={styles.instructions} aria-label={t('整理要求')}>
    <label htmlFor="photo-agent-instructions">{t('整理要求')}</label>
    <p>{t('告诉 Agent 检查哪些照片、按什么标准判断，以及建议怎么处理。保存后，Agent 下次整理时读取；不会自动开始扫描。')}</p>
    <textarea id="photo-agent-instructions" rows={4} maxLength={8000}
      placeholder={t('例如：只按文件名和属性检查截图，不读取图片；明确的截图建议发送到素材，拿不准的保留。所有操作先提交申请，由我审批。')}
      value={draft?.instructions ?? query.data?.instructions ?? ''}
      disabled={!query.data || saving}
      onChange={event=>{if(query.data){setDraft({instructions:event.target.value,revision:draft?.revision??query.data.revision});setMessage('');}}}/>
    <div className={styles.instructionActions}>
      <button type="button" disabled={!draft || saving || !query.data} onClick={()=>void save()}>{saving?t('正在保存…'):t('保存要求')}</button>
      {(query.error || error) && <><span role="alert">{error||query.error?.message}</span><button type="button" disabled={saving} onClick={()=>{setDraft(null);setError('');void query.refetch();}}>{t('重新加载要求')}</button></>}
      {message && <span role="status">{message}</span>}
      {query.isPending && <span role="status">{t('正在加载整理要求…')}</span>}
    </div>
  </section>;
}
