import axios from 'axios';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer, type BrowserClient } from '../src/tools/web';
import { createClientServerPair } from '../src/lib/mcp';
import { renderMessage } from '../src/server/styling';
import { isScreenshot } from '../src/lib/images';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';
function fake() {
  const calls: string[] = [];
  let failure = false;
  let truncated = false;
  let created = 0;
  const api: BrowserClient = {
    async browser() { calls.push('create'); return { success: true, id: `remote-${++created}` }; },
    async browserExecute(id, args) {
      calls.push(args.code);
      if (failure) throw new Error('secret-key-in-provider-error');
      return { success: true, exitCode: 0, truncated, stdout: JSON.stringify({url: 'https://example.com', text:'Page text', image:png}) };
    },
    async deleteBrowser(id) { calls.push('close:'+id); return { success: true, creditsBilled: 2 }; },
  };
  return { api, calls, fail: () => { failure = true; }, truncate: () => { truncated = true; } };
}
const metadata = (r: any) => JSON.parse(r.content[0].text);

test('real MCP tools expose images, isolate sessions, reject stale actions and clean up', async () => {
  const a = fake(), b = fake();
  const sa = createWebServer(a.api), sb = createWebServer(b.api);
  const [ca] = await createClientServerPair(sa), [cb] = await createClientServerPair(sb);
  try {
    assert.deepEqual((await ca.listTools()).tools.map(t=>t.name), ['open','act','close']);
    const first: any = await ca.callTool({name:'open',arguments:{url:'https://example.com',viewport:'mobile'}});
    assert.equal(first.isError, undefined);
    assert.equal(first.content[1].data, png);
    assert.ok(isScreenshot(first.content[1].data,first.content[1].mimeType));
    const m = metadata(first);
    const foreign: any = await cb.callTool({name:'act',arguments:{session:m.session,observation:1,action:{type:'wait'}}});
    assert.equal(foreign.isError,true);
    assert.equal(b.calls.length,0);
    const outside: any = await ca.callTool({name:'act',arguments:{session:m.session,observation:1,action:{type:'click',x:500,y:10}}});
    assert.equal(outside.isError,true);
    const actions = await Promise.all([1,2].map(()=>ca.callTool({name:'act',arguments:{session:m.session,observation:1,action:{type:'scroll',deltaY:200}}})));
    assert.equal(actions.filter(r=>r.isError).length,1);
    assert.equal(a.calls.filter(c=>c.includes('mouse.wheel')).length,1);
    const html = renderMessage({role:'user',content:[{type:'tool_result',toolUseId:'call',toolUseName:'web-open',isError:false,content:first.content}]},0);
    assert.match(html,/src="data:image\/png;base64,/);
    assert.doesNotMatch(html,/&quot;data&quot;/);
    await sa.close();
    assert.ok(a.calls.some(c=>c.startsWith('close:')));
    assert.equal(a.calls.filter(c=>c.startsWith('close:')).length,1);
  } finally { await sa.close(); await sb.close(); await ca.close(); await cb.close(); }
});

test('invalid inputs, missing credentials, provider errors and truncated captures return safe tool errors', async () => {
  const prior=process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  const s=createWebServer(); const [c]=await createClientServerPair(s);
  try {
    const r:any=await c.callTool({name:'open',arguments:{url:'https://example.com'}});
    assert.equal(r.isError,true); assert.match(r.content[0].text,/FIRECRAWL_API_KEY/);
  } finally { await s.close(); await c.close(); if(prior!==undefined) process.env.FIRECRAWL_API_KEY=prior; }
  for (const mode of ['fail','truncate'] as const) {
    const f=fake(); f[mode](); const s=createWebServer(f.api); const [c]=await createClientServerPair(s);
    try {
      const invalid:any=await c.callTool({name:'open',arguments:{url:'file:///tmp/x'}});
      assert.equal(invalid.isError,true); assert.equal(f.calls.length,0);
      const r:any=await c.callTool({name:'open',arguments:{url:'https://example.com'}});
      assert.equal(r.isError,true); assert.doesNotMatch(JSON.stringify(r),/secret-key/);
      assert.ok(f.calls.some(c=>c.startsWith('close:')));
    } finally { await s.close(); await c.close(); }
  }
});

test('bounded actions and sessions; expired handles do not silently create a browser', async () => {
  const f=fake(), s=createWebServer(f.api); const [c]=await createClientServerPair(s);
  const original=Date.now;
  try {
    const first=metadata(await c.callTool({name:'open',arguments:{url:'https://example.com'}}));
    for(let i=1;i<=10;i++) {
      const r:any=await c.callTool({name:'act',arguments:{session:first.session,observation:i,action:{type:'wait',milliseconds:0}}});
      assert.ok(!r.isError);
    }
    const over:any=await c.callTool({name:'act',arguments:{session:first.session,observation:11,action:{type:'wait'}}});
    assert.equal(over.isError,true); assert.match(over.content[0].text,/limit/);
    const second=metadata(await c.callTool({name:'open',arguments:{url:'https://example.com'}}));
    Date.now=()=>original()+301000;
    const expired:any=await c.callTool({name:'act',arguments:{session:second.session,observation:1,action:{type:'wait'}}});
    assert.equal(expired.isError,true); assert.match(expired.content[0].text,/expired/);
    const third:any=await c.callTool({name:'open',arguments:{url:'https://example.com'}});
    assert.equal(third.isError,true); assert.equal(f.calls.filter(c=>c==='create').length,2);
  } finally { Date.now=original; await s.close(); await c.close(); }
});

test('dashboard rejects invalid data URLs and image dimensions', () => {
  assert.equal(isScreenshot('bad" onload="alert(1)', 'image/png'),false);
  assert.equal(isScreenshot(png,'image/svg+xml'),false);
  const bytes=Buffer.from(png,'base64'); bytes.writeUInt32BE(50000,16);
  assert.equal(isScreenshot(bytes.toString('base64'),'image/png'),false);
});

test('real SDK transport makes one attempt, returns an image and deletes the session', async () => {
  const adapter=axios.defaults.adapter;
  const key=process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY='test-only';
  const urls:string[]=[];
  axios.defaults.adapter=async config=>{
    urls.push(config.url!);
    const data=config.method==='delete'?{success:true}:config.url!.endsWith('/execute')?
      {success:true,exitCode:0,stdout:JSON.stringify({url:'https://example.com',text:'Observed',image:png})}:
      {success:true,id:'transport-session'};
    return {data,status:200,statusText:'OK',headers:{},config};
  };
  const s=createWebServer(); const [c]=await createClientServerPair(s);
  try {
    const r:any=await c.callTool({name:'open',arguments:{url:'https://example.com'}});
    assert.ok(!r.isError,JSON.stringify(r)); assert.equal(r.content[1].data,png);
    await s.close();
    assert.equal(urls.length,3); assert.match(urls[1],/transport-session\/execute$/);
  } finally {await s.close();await c.close();axios.defaults.adapter=adapter;if(key===undefined)delete process.env.FIRECRAWL_API_KEY;else process.env.FIRECRAWL_API_KEY=key;}
});
