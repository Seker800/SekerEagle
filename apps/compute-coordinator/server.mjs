import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
export function authenticated(header,token) {
  const actual=Buffer.from(header??''),expected=Buffer.from(`Bearer ${token}`);
  return Boolean(token)&&actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export async function boundedBody(stream,maximum) {
  const chunks=[];let size=0;
  for await(const chunk of stream) {size+=chunk.length;if(size>maximum) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413});chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
function json(res,status,value) {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
export function createCoordinator({fleet,executionToken,adminToken,fetcher=fetch,timeoutMs=120000}) {
  if(!executionToken || !adminToken || executionToken===adminToken) throw new Error('DISTINCT_CREDENTIALS_REQUIRED');
  const server=createServer(async(req,res)=>{
    let slot;
    try {
      const path=req.url;
      const admin=path?.startsWith('/admin/');
      if(!authenticated(req.headers.authorization,admin?adminToken:executionToken)) return json(res,401,{error:'UNAUTHORIZED'});
      if(path==='/admin/fleet' && req.method==='GET') return json(res,200,fleet.snapshot());
      if(path==='/admin/policy' && req.method==='POST') {
        const input=JSON.parse((await boundedBody(req,16384)).toString('utf8'));
        const allowed=['expectedRevision','nodeId','enabled','concurrency','operations','durationSeconds','reason'];
        if(!input || Object.keys(input).some(k=>!allowed.includes(k))) return json(res,400,{error:'INVALID_POLICY'});
        return json(res,200,await fleet.update(input));
      }
      if(path==='/healthz' && req.method==='GET') {
        const s=fleet.snapshot();const embedding=s.nodes.filter(n=>n.enabled&&n.health==='READY'&&n.operations.includes('embedding'));
        return json(res,200,{status:embedding.length?'ready':'offline',...fleet.contract,accelerator:'pool',protocol:'sekereagle-compute-v1',capacity:{backgroundLimit:s.backgroundLimit},fleet:s});
      }
      const routes={
        '/v1/embeddings/image':{operation:'embedding',interactive:false,types:['image/jpeg','image/png','image/webp'],maximum:20*1024*1024},
        '/v1/embeddings/text':{operation:'embedding',interactive:true,types:['application/json'],maximum:16384},
        '/v1/media/image':{operation:'image',interactive:false,types:['application/octet-stream'],maximum:256*1024*1024},
        '/v1/media/faces':{operation:'faces',interactive:false,types:['image/jpeg','image/png','image/webp'],maximum:20*1024*1024},
      };
      const route=routes[path]; if(!route || req.method!=='POST') return json(res,404,{error:'NOT_FOUND'});
      if(route.operation==='embedding' && req.headers['x-embedding-dimensions']!==String(fleet.contract.dimensions)) return json(res,409,{error:'DIMENSION_MISMATCH'});
      const contentType=req.headers['content-type']?.split(';')[0];
      if(!route.types.includes(contentType)) return json(res,415,{error:'UNSUPPORTED_MEDIA'});
      slot=fleet.acquire(route.operation,route.interactive);
      if(!slot){res.setHeader('Retry-After','1');return json(res,503,{error:'COMPUTE_BUSY'});}
      const started=Date.now();
      // Keep the host reservation if the original caller disconnects: upstream computation
      // is allowed to finish. Incoming body and upstream response have independent bounds.
      const body=await boundedBody(req,route.maximum);
      const headers={authorization:`Bearer ${slot.node.token}`,'content-type':contentType};
      if(route.operation==='embedding')headers['x-embedding-dimensions']=String(fleet.contract.dimensions);
      if(route.operation==='image') {
        const work=req.headers['x-image-work'];if(typeof work!=='string'||work.length>2048)return json(res,400,{error:'INVALID_IMAGE_WORK'});headers['x-image-work']=work;
      }
      const upstream=await fetcher(slot.node.url+path,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      if(!upstream.ok) {
        if(upstream.status>=500 || upstream.status===429)fleet.markHealth(slot.node.id,null);
        if(upstream.body)await upstream.body.cancel();
        res.setHeader('Retry-After','1');return json(res,[400,408,409,413,415,422,429,503].includes(upstream.status)?upstream.status:502,{error:'COMPUTE_REQUEST_FAILED'});
      }
      const output=await boundedBody(upstream.body,route.operation==='image'?96*1024*1024:128*1024);
      JSON.parse(output.toString('utf8'));
      if(!res.destroyed){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(output);}
      slot.release(Date.now()-started);slot=null;
    } catch(e) {
      if(slot)fleet.markHealth(slot.node.id,null);
      if(!res.destroyed && !res.headersSent)json(res,e.status??(e.message==='REVISION_CONFLICT'?409:e.message==='NODE_NOT_FOUND'?404:e.name==='SyntaxError'||e.message?.startsWith('INVALID_')?400:502),{error:e.status===413?'PAYLOAD_TOO_LARGE':e.message==='REVISION_CONFLICT'?'REVISION_CONFLICT':'COMPUTE_REQUEST_FAILED'});
    } finally {if(slot)slot.release(1);}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.maxHeadersCount=32;
  return server;
}
export async function probeFleet(fleet,fetcher=fetch) {
 await Promise.all(fleet.state.nodes.map(async node=>{
  try {const path=node.operations.includes('embedding')?'/healthz':'/healthz';const r=await fetcher(node.url+path,{headers:{authorization:`Bearer ${node.token}`},redirect:'error',signal:AbortSignal.timeout(2000)});if(!r.ok)throw new Error('HEALTH_FAILED');const bytes=await boundedBody(r.body,16384);fleet.markHealth(node.id,JSON.parse(bytes.toString('utf8')));}
  catch {fleet.markHealth(node.id,null);}
 }));
}
