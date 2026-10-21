/** Trusted NAS maintenance command. No HTTP listener, decoder or recovery scheduler. */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '@nestjs/config';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { PrismaService } from '../prisma/prisma.service';
import { PatService } from '../auth/pat.service';
import { DeploymentIdentityService } from '../auth/deployment-identity.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { EagleMediaCapabilityService } from '../eagle/eagle-media-capability.service';
import { EagleUploadInspectionService } from '../eagle/eagle-upload-inspection.service';
import { EagleUploadService } from '../eagle/eagle-upload.service';
import { openFrozenSource, assertFrozenSource, type FrozenSource } from './local-copy-source';

type Row = FrozenSource & { mime: string; upload_name: string; sha256: string | null;
  session_id: string | null; attempts: number; status: string };
const state = '/state';
let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));

export function assertLocalCopyIdentity(principal: {sub:string;scopes:readonly string[]}, owner: string | undefined,
  deployment: string, expectedDeployment: string | undefined): void {
  if (!principal.scopes.includes('asset:write')) throw new Error('UPLOAD_SCOPE_REQUIRED');
  if (principal.sub !== owner || deployment !== expectedDeployment) throw new Error('IMPORT_IDENTITY_CHANGED');
}

async function main() {
  process.umask(0o077);
  assertSafeRuntimeTarget({ databaseUrl: process.env.DATABASE_URL!,
    s3Endpoint: process.env.S3_ENDPOINT!, s3Bucket: process.env.S3_BUCKET! });
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  const limit = limitAt < 0 ? Infinity : Number(args[limitAt + 1]);
  if (!(limit === Infinity || Number.isInteger(limit) && limit >= 1 && limit <= 100))
    throw new Error('INVALID_PILOT_LIMIT');
  for (const p of [state, `${state}/journal.sqlite`, `${state}/token`]) {
    const s = await lstat(p);
    if (s.isSymbolicLink() || (s.mode & 0o077) !== 0) throw new Error('PRIVATE_STATE_REQUIRED');
  }
  const db = new DatabaseSync(`${state}/journal.sqlite`);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=30000;');
  const meta = (key: string) => (db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;
  if (meta('schema_version') !== '2' || meta('inventory_complete') !== '1')
    throw new Error('FROZEN_INVENTORY_REQUIRED');
  const prisma = new PrismaService();
  const storage = new ObjectStorageService(new ConfigService(process.env));
  const capabilities = new EagleMediaCapabilityService();
  const uploads = new EagleUploadService(prisma, storage, capabilities,
    new EagleUploadInspectionService(storage), 'PHOTO');
  const pat = new PatService(prisma);
  const identity = new DeploymentIdentityService(prisma);
  const authorize = async () => {
    const principal = await pat.authenticate((await readFile(`${state}/token`, 'utf8')).trim());
    assertLocalCopyIdentity(principal, meta('authenticated_user'), await identity.get(), meta('deployment'));
    return principal.sub;
  };
  const update = (row: Row, fields: Record<string, string | number | null>) => {
    const keys = Object.keys(fields);
    const allowed = new Set(['status','sha256','session_id','part_size','asset_id','media_status','attempts','error']);
    if (!keys.every(k => allowed.has(k))) throw new Error('INVALID_CHECKPOINT_FIELD');
    db.prepare(`UPDATE items SET ${keys.map(k => `${k}=?`).join(',')} WHERE path=?`)
      .run(...keys.map(k => fields[k]!), row.path);
  };
  const counts = () => Object.fromEntries((db.prepare('SELECT status,count(*) AS n FROM items GROUP BY status').all() as Array<{status:string;n:number}>).map(r=>[r.status,r.n]));
  let consecutiveErrors = 0, count = 0;
  try {
    await prisma.$connect();
    await authorize();
    log('local_copy_started', { counts: counts(), concurrency: 2, decoding: false });
    while (!stop && count < limit) {
      const owner = await authorize();
      const rows = db.prepare("SELECT * FROM items WHERE status IN ('PENDING','UPLOADING') ORDER BY capture DESC,path LIMIT ?")
        .all(Math.min(25, limit-count)) as unknown as Row[];
      if (!rows.length) break;
      // Two bounded copies, always dispatched from the newest remaining rows.
      for (let index = 0; index < rows.length && !stop; index += 2) {
        const results = await Promise.allSettled(rows.slice(index,index+2).map(async row => {
          const started = performance.now();
          const file = await openFrozenSource(row);
          try {
            capabilities.assertUploadAllowed({ fileName: row.upload_name, mimeType: row.mime, size: row.size });
            let session = row.session_id ? await prisma.uploadSession.findFirst({
              where: { id: row.session_id, uploaderId: owner, libraryMode: 'PHOTO' },
              include: { eagleState: true },
            }) : null;
            if (row.session_id && !session) throw new Error('SESSION_SCOPE_MISMATCH');
            if (session?.status === 'COMPLETED') {
              update(row,{status:'IMPORTED',asset_id:session.eagleAssetId,media_status:'PROCESSING',error:null}); return;
            }
            if (!session || session.status === 'ABORTED') {
              const created = await uploads.initiate(owner,{ originalName:row.upload_name,
                mimeType:row.mime,size:row.size,duplicatePolicy:'SKIP',...(row.sha256?{contentSha256:row.sha256}:{}) });
              update(row,{status:'UPLOADING',session_id:created.id,part_size:created.partSize});
              session = await prisma.uploadSession.findFirstOrThrow({
                where:{id:created.id,uploaderId:owner,libraryMode:'PHOTO'},include:{eagleState:true} });
            }
            if (session.status === 'FINALIZING') throw new Error('SESSION_STILL_FINALIZING');
            const assembled = session.status === 'ASSEMBLED' || session.status === 'FAILED';
            const partSize = uploads.partSizeFor(row.size);
            const existing = assembled ? [] : await storage.listMultipartUploadParts(session.objectKey,session.multipartUploadId);
            const hash = createHash('sha256');
            const parts:Array<{partNumber:number;etag:string}>=[];
            let position=0, number=1;
            while(position < row.size) {
              if(stop) return;
              const bytes = Buffer.allocUnsafe(Math.min(partSize,row.size-position));
              let read=0;
              while(read<bytes.length) {
                const result=await file.read(bytes,read,bytes.length-read,position+read);
                if(!result.bytesRead) throw new Error('SOURCE_TRUNCATED');
                read+=result.bytesRead;
              }
              hash.update(bytes);
              if(!assembled) {
                const prior=existing.find(p=>p.partNumber===number);
                const md5=createHash('md5').update(bytes).digest('hex');
                const etag=prior?.size===bytes.length && prior.etag.replaceAll('"','')===md5 ? prior.etag
                  : await storage.uploadLocalPart(session.objectKey,session.multipartUploadId,number,bytes);
                parts.push({partNumber:number,etag});
              }
              position+=bytes.length;number++;
            }
            await assertFrozenSource(file,row);
            const sha256=hash.digest('hex');
            if(row.sha256 && row.sha256!==sha256) throw new Error('SOURCE_CHANGED');
            update(row,{sha256});
            if(assembled) {
              // Legacy uploads are verified as bytes only, never by a RAW decoder.
              const stored=await storage.getObject(session.objectKey);
              if(!stored.Body) throw new Error('STORED_ORIGINAL_MISSING');
              const check=createHash('sha256');let size=0;
              for await(const chunk of stored.Body as AsyncIterable<Buffer>) {check.update(chunk);size+=chunk.length;}
              if(size!==row.size || check.digest('hex')!==sha256) throw new Error('STORED_ORIGINAL_MISMATCH');
              const saved=session.completionParts;
              if(!Array.isArray(saved) || !saved.length) throw new Error('ASSEMBLED_PARTS_MISSING');
              for(const part of saved) {
                const p=part as {PartNumber?:number;partNumber?:number;ETag?:string;etag?:string};
                parts.push({partNumber:Number(p.PartNumber??p.partNumber),etag:String(p.ETag??p.etag)});
              }
            } else await storage.completeMultipartUpload(session.objectKey,session.multipartUploadId,
              parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag})));
            const result=await uploads.completeLocalCopy(owner,session.id,sha256,parts);
            update(row,{status:'IMPORTED',asset_id:result.assetId,media_status:'PROCESSING',error:null});
            log('local_copy_file',{mime:row.mime,sourceBytes:row.size,seconds:Math.round((performance.now()-started)/10)/100,duplicate:result.duplicate});
          } finally {await file.close();}
        }));
        for(let i=0;i<results.length;i++) {
          const result=results[i]!;const row=rows[index+i]!;count++;
          if(result.status==='fulfilled') {consecutiveErrors=0;continue;}
          const reason=result.reason as Error;
          const code=/^[A-Z][A-Z_]{0,80}$/.test(reason.message)?reason.message:'LOCAL_COPY_RETRYABLE';
          update(row,{attempts:row.attempts+1,error:code,...(code.startsWith('SOURCE_')?{status:'SOURCE_CHANGED'}:{})});
          log('local_copy_error',{code});
          if(++consecutiveErrors>=3 || reason.name==='UnauthorizedException') throw new Error('LOCAL_COPY_PAUSED_AFTER_ERRORS');
          await new Promise(resolve=>setTimeout(resolve,5000));
        }
      }
      log('local_copy_progress',{counts:counts()});
    }
    log(stop || count>=limit?'local_copy_paused':'local_copy_complete',{counts:counts()});
  } finally {db.close();storage.onModuleDestroy();await prisma.$disconnect();}
}
if(require.main===module) main().catch(()=>{log('local_copy_stopped',{code:'LOCAL_COPY_FAILED'});process.exitCode=1;});
