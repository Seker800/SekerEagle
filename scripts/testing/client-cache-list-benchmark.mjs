import { setTimeout, clearTimeout } from 'node:timers';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

// Controlled real Electron A/B, including preload IPC, utility RPC, disk IO,
// actual WebP decoding and two animation frames. Never accesses a user library.
const root = resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const sharp = createRequire(join(root, 'apps/api/package.json'))('sharp');
const images = Object.fromEntries(
  await Promise.all(
    ['MATERIAL', 'PHOTO'].map(async (mode) => [
      mode,
      (
        await sharp({
          create: {
            width: 64,
            height: 64,
            channels: 3,
            background: mode === 'PHOTO' ? '#007733' : '#3344bb',
          },
        })
          .webp()
          .toBuffer()
      ).toString('base64'),
    ]),
  ),
);
const directory = await mkdtemp(join(tmpdir(), 'sekereagle-cache-list-'));
try {
  const entry = join(directory, 'fixture.cjs');
  const source = `
    import { app, BrowserWindow, protocol, session, ipcMain, utilityProcess } from 'electron';
    import { createServer } from 'node:http';
    import { createReadStream } from 'node:fs';
    import { Readable } from 'node:stream';
    import { MediaCacheController } from './apps/desktop/src/main/media-cache-controller';
    import { MediaRequestLimiter } from './apps/desktop/src/main/media-request-limiter';
    import { LibraryMediaSnapshot } from './apps/desktop/src/main/library-media-snapshot';
    import { registerLibraryReadIpc } from './apps/desktop/src/main/library-read-ipc';
    import { CacheRpcClient } from './apps/desktop/src/shared/cache-rpc';
    import { desktopContentSecurityPolicy, isAllowedMediaOrigin, mediaCorsHeaders } from './apps/desktop/src/main/navigation-policy';
    (async()=>{
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.setName('SekerEagle list cache benchmark');
      protocol.registerSchemesAsPrivileged([{scheme:'sekereagle-media', privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
      const payloads = Object.fromEntries(Object.entries(${JSON.stringify(images)}).map(([k,v])=>[k,Buffer.from(v,'base64')]));
      const uuid = n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
      const list = mode=>({items:Array.from({length:200},(_,i)=>({id:uuid(i+1),libraryMode:mode,isPrivate:false,deletedAt:null,mediaRevision:1,originalName:'fixture-image.jpg',displayName:'fixture-image',mimeType:'image/jpeg',width:6000,height:4000,manualTags:Array.from({length:12},(_,n)=>({id:uuid(500+n),name:'Synthetic tag '+n,color:null})),photoMetadata:{cameraMake:'Fixture',cameraModel:'Synthetic camera',capturedAt:'2026-11-02T00:00:00Z'},renditions:[{id:uuid(i+101),kind:'THUMBNAIL',revision:1,mimeType:'image/webp',byteSize:payloads[mode].length}]}))});
      let delay=0,enabled=false,counts={lists:0,bodies:0,validations:0};
      const server=createServer((request,response)=>{
        if(request.url==='/'){response.setHeader('Content-Security-Policy',desktopContentSecurityPolicy);response.end('<!doctype html><style>body{display:flex;flex-wrap:wrap}img{width:64px;height:64px}</style><title>Cache benchmark</title>');return;}
        const mode=request.url.startsWith('/api/photos/')?'PHOTO':'MATERIAL';
        setTimeout(()=>{
          response.setHeader('Cache-Control','private, no-cache');
          if(request.url.endsWith('/assets')){counts.lists++;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(list(mode)));return;}
          response.setHeader('X-SekerEagle-Desktop-Cache','public-derived-v1');response.setHeader('ETag','"'+mode+'"');
          if(request.headers['if-none-match']==='"'+mode+'"'){counts.validations++;response.writeHead(304);response.end();return;}
          counts.bodies++;response.setHeader('Content-Type','image/webp');response.setHeader('Content-Length',String(payloads[mode].length));response.end(payloads[mode]);
        },delay);
      });
      await app.whenReady();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const origin='http://127.0.0.1:'+server.address().port;
      const child=utilityProcess.fork(${JSON.stringify(join(root, 'apps/desktop/dist/utility.cjs'))},[],{serviceName:'SekerEagle disposable cache benchmark'});
      const cache=new CacheRpcClient({postMessage:m=>child.postMessage(m),subscribe:listener=>{child.on('message',listener);return()=>child.off('message',listener);}});
      await cache.initialize({cacheRoot:${JSON.stringify(join(directory, 'cache'))},limitBytes:8*1024**2,enforceDiskSafety:false});
      const identity={ownerId:'fixture',deploymentId:'d'.repeat(64)};
      const snapshot=new LibraryMediaSnapshot({authenticatedOwner:async()=>identity,fetch:(path,init)=>session.defaultSession.fetch(origin+path,init)});
      const limiter=new MediaRequestLimiter(6,64);
      const controller=new MediaCacheController({serverUrl:origin,cache,authenticatedOwner:async()=>identity,canReadLocal:(media,owner,file)=>enabled&&snapshot.allows(media,owner,file),fetchUpstream:(path,options)=>limiter.fetch(signal=>session.defaultSession.fetch(origin+path,{signal,headers:{'cache-control':'no-store',...(options.ifNoneMatch?{'if-none-match':options.ifNoneMatch}:{})}}),options.signal)});
      protocol.handle('sekereagle-media',async request=>{
        if(!isAllowedMediaOrigin(origin,request.headers.get('origin')))return new Response(null,{status:403});
        const result=await controller.resolve(request.url,request.signal);
        if(result.source==='error')return new Response(null,{status:result.status});
        if(result.source==='upstream')return result.response;
        const stream=createReadStream(result.filePath);stream.on('close',()=>void cache.release(result.leaseId));
        return new Response(Readable.toWeb(stream),{headers:{...mediaCorsHeaders(origin),'content-type':result.contentType,'cache-control':'no-store','x-sekereagle-cache-result':result.cacheResult}});
      });
      const window=new BrowserWindow({show:false,width:800,height:600,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,preload:${JSON.stringify(join(root, 'apps/desktop/dist/preload.cjs'))}}});
      registerLibraryReadIpc({ipcMain,snapshot:()=>snapshot,assertTrustedIpcSender:event=>{if(event.sender!==window.webContents||event.senderFrame?.url!==origin+'/')throw new Error('untrusted');}});
      const run=async (mode,optimized=false)=>window.webContents.executeJavaScript(\`(async()=>{
        document.body.replaceChildren();const started=performance.now();
        const path='/api/'+('\${mode}'==='PHOTO'?'photos':'eagle')+'/assets';
        const page=\${optimized} ? JSON.parse((await window.sekerDesktop.readLibrary(path,crypto.randomUUID())).body) : await (await fetch(path,{credentials:'include',cache:'no-store'})).json();
        const items=page.items;const listMs=performance.now()-started;
        const results=await Promise.all(items.slice(0,24).map(async asset=>{const r=asset.renditions[0];const u=window.sekerDesktop.createMediaUrl({libraryMode:asset.libraryMode,kind:'RENDITION',renditionKind:r.kind,assetId:asset.id,renditionId:r.id});const response=await fetch(u,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('media failed');const blob=await response.blob();const url=URL.createObjectURL(blob);const image=new Image();image.src=url;document.body.append(image);await image.decode();URL.revokeObjectURL(url);if(image.naturalWidth!==64)throw new Error('decode failed');return response.headers.get('x-sekereagle-cache-result');}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {listMs,frameMs:performance.now()-started,results};
      })()\`);
      try {
        await window.loadURL(origin);
        // Warm only the disposable disk cache; every later read still enters the protocol.
        for(const mode of ['MATERIAL','PHOTO'])await run(mode);
        const evidence=[];
        for(const latency of [0,30,80])for(const mode of ['MATERIAL','PHOTO'])for(let repetition=0;repetition<5;repetition++){
          delay=latency;
          for(const optimized of (repetition%2?[true,false]:[false,true])){
            enabled=optimized;counts={lists:0,bodies:0,validations:0};
            const result=await run(mode,optimized);
            evidence.push({latency,mode,optimized,repetition,...result,counts:{...counts}});
          }
        }
        process.stdout.write('LIST_CACHE_BENCHMARK '+JSON.stringify(evidence)+'\\n');
      } finally {window.destroy();snapshot.reset();await cache.close();child.kill();server.close();app.quit();}
    })().catch(error=>{process.stderr.write(String(error.stack??error));app.exit(1)});
  `;
  await build({
    stdin: {
      contents: source,
      resolveDir: root,
      sourcefile: 'list-cache-fixture.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: entry,
    external: ['electron'],
    logLevel: 'silent',
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '',
    errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(code, 0, errors);
  const line = output.split('\n').find((line) => line.startsWith('LIST_CACHE_BENCHMARK '));
  assert(line, errors || output);
  const samples = JSON.parse(line.slice('LIST_CACHE_BENCHMARK '.length));
  for (const sample of samples) {
    assert.deepEqual(sample.counts, {
      lists: 1,
      bodies: 0,
      validations: sample.optimized ? 0 : 24,
    });
    assert(sample.results.every((value) => value === (sample.optimized ? 'LOCAL' : 'REVALIDATED')));
  }
  const summary = [];
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const latency of [0, 30, 80])
    for (const mode of ['MATERIAL', 'PHOTO']) {
      const group = samples.filter((s) => s.latency === latency && s.mode === mode);
      const baselineMs = median(group.filter((s) => !s.optimized).map((s) => s.frameMs));
      const optimizedMs = median(group.filter((s) => s.optimized).map((s) => s.frameMs));
      summary.push({
        latency,
        mode,
        baselineMs: Math.round(baselineMs),
        optimizedMs: Math.round(optimizedMs),
        savedMs: Math.round(baselineMs - optimizedMs),
      });
      if (latency >= 30) assert(optimizedMs < baselineMs * 0.7, JSON.stringify(summary.at(-1)));
    }
  process.stdout.write(JSON.stringify({ summary, samples }, null, 2) + '\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
