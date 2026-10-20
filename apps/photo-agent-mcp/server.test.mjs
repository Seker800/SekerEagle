import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPhotoAgentServer, validateLocalBase } from './server.mjs';
test('MCP refuses non-loopback endpoints and URL credentials', () => {
  for (const url of ['https://example.org','http://192.168.31.89','http://user:secret@127.0.0.1:3000','http://127.0.0.1:8180/api']) assert.throws(()=>validateLocalBase(url));
  assert.equal(validateLocalBase('http://127.0.0.1:57894'), 'http://127.0.0.1:57894');
});
test('real MCP discovery and calls expose only scoped reads and proposals', async () => {
  const calls=[];
  const server=createPhotoAgentServer({baseUrl:'http://127.0.0.1:3000', token:'test-only',fetch:async (url,init)=>{calls.push({url,init});return new Response(JSON.stringify({items:[]}),{headers:{'content-type':'application/json'}});}});
  const [a,b]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'test',version:'1'});
  await server.connect(a); await client.connect(b);
  try {
    const {tools}=await client.listTools();
    assert.ok(tools.some(t=>t.name==='photo_propose'));
    assert.ok(tools.every(t=>!/(delete|trash|apply|accept|undo|sql)/i.test(t.name)));
    const result=await client.callTool({name:'photo_list',arguments:{limit:20}});
    assert.equal(result.isError,undefined);
    assert.ok(calls[0].url.endsWith('/api/photos/agent/photos?limit=20'));
    assert.equal(calls[0].init.headers.authorization,'Bearer test-only');
    assert.equal(calls[0].init.redirect,'error');
    const bad=await client.callTool({name:'photo_list',arguments:{limit:20,ownerId:'other'}});
    assert.equal(bad.isError,true);
  } finally {await client.close();await server.close();}
});
