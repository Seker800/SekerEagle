import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

// A hidden Electron with a disposable profile and loopback HTTP fixtures.
// Never opens the user's client, reads credentials, or connects to a real library.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'sekereagle-cache-electron-'));
const entry = join(directory, 'fixture.cjs');
const root = resolve(new URL('../..', import.meta.url).pathname);
try {
  const source = `
    import { app, BrowserWindow, protocol, session } from 'electron';
    import { createServer } from 'node:http';
    import { createReadStream } from 'node:fs';
    import { Readable } from 'node:stream';
    import { join } from 'node:path';
    import { MediaCacheController } from './apps/desktop/src/main/media-cache-controller';
    import { MediaSnapshotAuthorization } from './apps/desktop/src/main/media-snapshot-authorization';
    import { CacheEngine } from './apps/desktop/src/utility/cache/cache-engine';
    import { desktopContentSecurityPolicy, isAllowedMediaOrigin, mediaCorsHeaders } from './apps/desktop/src/main/navigation-policy';
    import { buildNamespaceId } from './apps/desktop/src/shared/media-identity';
    (async()=>{
    app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
    app.setName('SekerEagle cache verification');
    protocol.registerSchemesAsPrivileged([{scheme:'sekereagle-media', privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
    const asset='00000000-0000-4000-8000-000000000001', rendition='00000000-0000-4000-8000-000000000002';
    const tileAsset='00000000-0000-4000-8000-000000000003', pyramid='00000000-0000-4000-8000-000000000004';
    let bodies=0, validations=0;
    const script = \`(async()=>{const renditions=[];for(const libraryMode of ['MATERIAL','PHOTO']){const u=window.sekerDesktop.createMediaUrl({libraryMode,kind:'RENDITION',renditionKind:'THUMBNAIL',assetId:'\${asset}',renditionId:'\${rendition}'});for(let i=0;i<2;i++){const response=await fetch(u,{credentials:'include'});renditions.push({mode:libraryMode,body:await response.text(),cacheResult:response.headers.get('x-sekereagle-cache-result')});}}const tiles=[];const tileUrl=window.sekerDesktop.createMediaUrl({libraryMode:'MATERIAL',kind:'TILE',assetId:'\${tileAsset}',pyramidId:'\${pyramid}',level:0,x:0,y:0});for(let i=0;i<2;i++){const response=await fetch(tileUrl,{credentials:'include'});tiles.push({body:await response.text(),cacheResult:response.headers.get('x-sekereagle-cache-result')});}return {renditions,tiles};})()\`;
    const server=createServer((request,response)=>{
      if(request.url==='/') {response.setHeader('Content-Security-Policy', desktopContentSecurityPolicy);response.end('<!doctype html><title>Cache verification</title>');return;}
      if(request.url==='/api/eagle/assets/'+tileAsset+'/pyramid') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({id:pyramid,revision:1,width:512,height:512,tileSize:256,overlap:0,format:'webp',maxLevel:1,tileUrlTemplate:'/api/eagle/assets/'+tileAsset+'/pyramids/'+pyramid+'/tiles/{level}/{x}/{y}'}));return;}
      const isTile=request.url?.includes('/pyramids/');const mode=request.url?.startsWith('/api/photos/')?'PHOTO':'MATERIAL';const etag=isTile?'"tile"':'"'+mode+'"';
      response.setHeader('X-SekerEagle-Desktop-Cache','public-derived-v1');response.setHeader('ETag',etag);
      if(request.headers['if-none-match']===etag){validations++;response.writeHead(304);response.end();return;}
      bodies++;response.setHeader('Content-Type','image/webp');const body=isTile?'TILE':mode;response.setHeader('Content-Length',String(body.length));response.end(body);
    });
    await app.whenReady();
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    const identity={ownerId:'fixture',deploymentId:'d'.repeat(64)};
    const engine=new CacheEngine({cacheRoot:${JSON.stringify(join(directory, 'cache'))},limitBytes:1024**2,enforceDiskSafety:false});await engine.initialize();
    const snapshot=new MediaSnapshotAuthorization({authenticatedOwner:async()=>identity,fetch:(path,init)=>session.defaultSession.fetch(origin+path,init)});
    await snapshot.read('/api/eagle/assets/'+tileAsset+'/pyramid');
    const controller=new MediaCacheController({serverUrl:origin,cache:engine,authenticatedOwner:async()=>identity,canReadLocal:(media,owner,file)=>snapshot.allows(media,owner,file),fetchUpstream:(path,options)=>session.defaultSession.fetch(origin+path,{headers:options.ifNoneMatch?{'if-none-match':options.ifNoneMatch}:{}})});
    protocol.handle('sekereagle-media',async request=>{if(!isAllowedMediaOrigin(origin,request.headers.get('origin')))return new Response(null,{status:403});const result=await controller.resolve(request.url);if(result.source==='upstream')return result.response;if(result.source==='error')return new Response(null,{status:result.status});const stream=createReadStream(result.filePath);stream.on('close',()=>engine.release(result.leaseId));return new Response(Readable.toWeb(stream),{headers:{...mediaCorsHeaders(origin),'content-type':result.contentType,'x-sekereagle-cache-result':result.cacheResult}});});
    const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,preload:${JSON.stringify(join(root, 'apps/desktop/dist/preload.cjs'))}}});
    window.webContents.on('console-message',(event)=>process.stderr.write(String(event.message)+'\\n'));
    try {await window.loadURL(origin);const results=await window.webContents.executeJavaScript(script);const waitUntil=Date.now()+5000;while(validations<2&&Date.now()<waitUntil)await new Promise(resolve=>setTimeout(resolve,25));process.stdout.write('CACHE_VERIFICATION '+JSON.stringify({results,bodies,validations,photoStats:controller.getRequestStats(buildNamespaceId(origin,'fixture','d'.repeat(64),'PHOTO')),materialStats:controller.getRequestStats(buildNamespaceId(origin,'fixture','d'.repeat(64),'MATERIAL'))})+'\\n');}
    finally{window.destroy();await engine.close();server.close();app.quit();}
    })().catch(error=>{process.stderr.write(String(error.stack ?? error));app.exit(1);});
  `;
  await build({
    stdin: { contents: source, resolveDir: root, sourcefile: 'cache-fixture.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: entry,
    external: ['electron'],
    logLevel: 'silent',
  });
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [entry], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(exit, 0, errors);
  const line = output.split('\n').find((value) => value.startsWith('CACHE_VERIFICATION '));
  assert(line, errors || output);
  const evidence = JSON.parse(line.slice('CACHE_VERIFICATION '.length));
  assert.deepEqual(
    evidence.results.renditions.map(({ mode, body, cacheResult }) => [mode, body, cacheResult]),
    [
      ['MATERIAL', 'MATERIAL', 'MISS'],
      ['MATERIAL', 'MATERIAL', 'OPTIMISTIC'],
      ['PHOTO', 'PHOTO', 'MISS'],
      ['PHOTO', 'PHOTO', 'OPTIMISTIC'],
    ],
  );
  assert.deepEqual(
    evidence.results.tiles.map(({ body, cacheResult }) => [body, cacheResult]),
    [
      ['TILE', 'MISS'],
      ['TILE', 'LOCAL'],
    ],
  );
  assert.equal(evidence.bodies, 3);
  assert.equal(evidence.validations, 2);
  assert.equal(evidence.photoStats.missCount, 1);
  assert.equal(evidence.photoStats.localHitCount, 1);
  assert.equal(evidence.photoStats.revalidatedHitCount, 0);
  assert.equal(evidence.photoStats.savedBytes, 5);
  assert.equal(evidence.materialStats.missCount, 2);
  assert.equal(evidence.materialStats.localHitCount, 2);
  assert.equal(evidence.materialStats.savedBytes, 12);
  process.stdout.write(JSON.stringify(evidence) + '\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
