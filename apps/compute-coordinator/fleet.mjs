import { open, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
export const OPERATIONS = ['embedding', 'image', 'faces'];
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
export function validateEnrollment(value) {
  if (!value || !idPattern.test(value.id) || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 80) throw new Error('INVALID_NODE');
  const url = new URL(value.url);
  const ip = url.hostname;
  const privateIp = isIP(ip) === 4 && (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
  if (!privateIp || ip === '192.168.31.89' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) throw new Error('INVALID_NODE_TARGET');
  if (typeof value.token !== 'string' || value.token.length < 8 || value.token.length > 1024 || /[\r\n]/.test(value.token)) throw new Error('INVALID_NODE_CREDENTIAL');
  if (!Number.isInteger(value.maxConcurrent) || value.maxConcurrent < 1 || value.maxConcurrent > 8 || !Number.isInteger(value.reserveInteractive) || value.reserveInteractive < 0 || value.reserveInteractive >= value.maxConcurrent) throw new Error('INVALID_CAPACITY');
  if (!Array.isArray(value.operations) || !value.operations.length || new Set(value.operations).size !== value.operations.length || !value.operations.every(x => OPERATIONS.includes(x)) || !['metal','cuda','cpu'].includes(value.accelerator) || typeof value.enabled !== 'boolean') throw new Error('INVALID_CAPABILITY');
  return { id:value.id, name:value.name, url:url.origin, token:value.token, accelerator:value.accelerator, operations:[...value.operations], maxConcurrent:value.maxConcurrent, reserveInteractive:value.reserveInteractive, enabled:value.enabled };
}
export async function readPrivateJson(path) {
  const h = await open(path, 'r');
  try {
    const stat = await h.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('PRIVATE_STATE_REQUIRED');
    return JSON.parse(await h.readFile('utf8'));
  } finally { await h.close(); }
}
export class Fleet {
  constructor({directory,contract,now=Date.now}) {
    this.directory=directory; this.contract=contract; this.now=now; this.state={revision:0,nodes:[],policies:{},audit:[]}; this.runtime=new Map(); this.writing=Promise.resolve();
  }
  async initialize(nodes) {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try { this.state=await readPrivateJson(join(this.directory,'state.json')); }
    catch(e) { if(e.code !== 'ENOENT') throw e; if(!nodes) throw new Error('FLEET_NOT_ENROLLED'); this.state.nodes=nodes.map(validateEnrollment); await this.persist(this.state); }
    if (!Number.isSafeInteger(this.state.revision) || this.state.revision < 0 || !Array.isArray(this.state.nodes) || this.state.nodes.length > 16 || !this.state.policies || !Array.isArray(this.state.audit)) throw new Error('INVALID_STATE');
    this.state.nodes=this.state.nodes.map(validateEnrollment);
    if(new Set(this.state.nodes.map(n=>n.id)).size !== this.state.nodes.length) throw new Error('DUPLICATE_NODE');
    for(const node of this.state.nodes) this.runtime.set(node.id,{health:'OFFLINE',seenAt:0,inFlight:0,background:0,ewma:1000,completed:0});
  }
  async persist(state) {
    const path=join(this.directory,`state-${randomUUID()}.tmp`); const h=await open(path,'wx',0o600);
    try { await h.writeFile(JSON.stringify(state)); await h.sync(); } finally { await h.close(); }
    await rename(path,join(this.directory,'state.json'));
  }
  policy(node) {
    const p=this.state.policies[node.id];
    return p && p.expiresAt > this.now() ? p : {enabled:node.enabled,concurrency:node.maxConcurrent,operations:node.operations,expiresAt:null,reason:'登记基线'};
  }
  update(input) {
    const operation=this.writing.then(async()=>{
      if(input.expectedRevision !== this.state.revision) throw new Error('REVISION_CONFLICT');
      const node=this.state.nodes.find(n=>n.id === input.nodeId); if(!node) throw new Error('NODE_NOT_FOUND');
      if(typeof input.enabled !== 'boolean' || !Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > node.maxConcurrent) throw new Error('INVALID_CAPACITY');
      if(!Array.isArray(input.operations) || !input.operations.length || new Set(input.operations).size !== input.operations.length || !input.operations.every(op=>node.operations.includes(op))) throw new Error('INVALID_CAPABILITY');
      if(!Number.isInteger(input.durationSeconds) || input.durationSeconds < 60 || input.durationSeconds > 604800 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 200) throw new Error('INVALID_POLICY');
      const next=structuredClone(this.state); next.revision++;
      next.policies[node.id]={enabled:input.enabled,concurrency:input.concurrency,operations:[...input.operations],expiresAt:this.now()+input.durationSeconds*1000,reason:input.reason};
      next.audit=[...next.audit,{revision:next.revision,at:this.now(),nodeId:node.id,...next.policies[node.id]}].slice(-200);
      await this.persist(next); this.state=next; return this.snapshot();
    }); this.writing=operation.catch(()=>{}); return operation;
  }
  markHealth(id, payload) {
    const node=this.state.nodes.find(n=>n.id===id), r=this.runtime.get(id); if(!node||!r) return;
    const embedding=!node.operations.includes('embedding') || (payload?.model===this.contract.model && payload?.revision===this.contract.revision && payload?.dimensions===this.contract.dimensions && (node.accelerator==='metal'?payload.metal===true:payload.accelerator===node.accelerator));
    const media=node.operations.every(op=>op==='embedding' || (payload?.protocol==='sekereagle-media-v1' && payload.operations?.includes(op)));
    r.health=payload?.status==='ready' && embedding && media ? 'READY' : payload ? 'DRIFTED' : 'OFFLINE'; r.seenAt=this.now();
  }
  available(node) { const r=this.runtime.get(node.id); return r && r.health==='READY' && this.now()-r.seenAt <= 15000; }
  snapshot() {
    const nodes=this.state.nodes.map(node=>{const p=this.policy(node),r=this.runtime.get(node.id);return {id:node.id,name:node.name,accelerator:node.accelerator,enabled:p.enabled,concurrency:p.concurrency,maxConcurrent:node.maxConcurrent,reserveInteractive:node.reserveInteractive,operations:p.operations,expiresAt:p.expiresAt,reason:p.reason,health:this.available(node)?'READY':r?.health==='DRIFTED'?'DRIFTED':'OFFLINE',inFlight:r?.inFlight??0,completed:r?.completed??0,averageMs:Math.round(r?.ewma??0)};});
    return {revision:this.state.revision,nodes,audit:this.state.audit,backgroundLimit:nodes.filter(n=>n.enabled&&n.health==='READY'&&n.operations.includes('embedding')).reduce((s,n)=>s+Math.max(0,n.concurrency-n.reserveInteractive),0)};
  }
  acquire(operation,interactive) {
    const candidates=this.state.nodes.filter(node=>{const p=this.policy(node),r=this.runtime.get(node.id);return this.available(node)&&p.enabled&&p.operations.includes(operation)&&r.inFlight<p.concurrency&&(interactive||r.background<Math.max(0,p.concurrency-node.reserveInteractive));});
    candidates.sort((a,b)=>{const x=this.runtime.get(a.id),y=this.runtime.get(b.id);return (x.inFlight+1)*x.ewma-(y.inFlight+1)*y.ewma || a.id.localeCompare(b.id);});
    const node=candidates[0]; if(!node) return null; const r=this.runtime.get(node.id); r.inFlight++; if(!interactive) r.background++;
    let released=false; return {node,release:(elapsed)=>{if(released)throw new Error('ALREADY_RELEASED');released=true;r.inFlight--;if(!interactive)r.background--;r.completed++;r.ewma=r.ewma*0.8+Math.max(1,elapsed)*0.2;}};
  }
}
