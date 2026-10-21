import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,stat,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openFrozenSource,assertFrozenSource } from './local-copy-source';
import { assertLocalCopyIdentity } from './local-copy';

test('local copy rejects missing upload scope and identity changes',()=>{
  assert.doesNotThrow(()=>assertLocalCopyIdentity({sub:'owner',scopes:['asset:write']},'owner','deploy','deploy'));
  for(const input of [{sub:'other',scopes:['asset:write']},{sub:'owner',scopes:[] }])
    assert.throws(()=>assertLocalCopyIdentity(input,'owner','deploy','deploy'));
  assert.throws(()=>assertLocalCopyIdentity({sub:'owner',scopes:['asset:write']},'owner','changed','deploy'));
});
test('local copy rejects traversal and control characters before opening files',async()=>{
  for(const path of ['/etc/passwd','../outside','a/../b','a//b','bad\nname'])
    await assert.rejects(openFrozenSource({path,size:1,mtime_ns:'0',inode:'0',device:'0'}),/SOURCE_PATH_INVALID/);
});
test('frozen descriptor rejects changed content, symlinks and directory escapes',{skip:process.platform!=='linux'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'local-copy-'));
  try {
    const source=join(root,'safe.jpg');await writeFile(source,'original');
    const s=await stat(source,{bigint:true});const row={path:'safe.jpg',size:Number(s.size),mtime_ns:s.mtimeNs.toString(),inode:s.ino.toString(),device:s.dev.toString()};
    const file=await openFrozenSource(row,root);
    try {assert.equal((await file.readFile()).toString(),'original');await writeFile(source,'changed');await assert.rejects(assertFrozenSource(file,row),/SOURCE_CHANGED/);}
    finally {await file.close();}
    await symlink('/etc/passwd',join(root,'link'));await assert.rejects(openFrozenSource({...row,path:'link'},root));
    await symlink('/etc',join(root,'alias'));await assert.rejects(openFrozenSource({...row,path:'alias/passwd'},root));
  }finally{await rm(root,{recursive:true,force:true});}
});
