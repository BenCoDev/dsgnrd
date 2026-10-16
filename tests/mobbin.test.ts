import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMobbinServer, createMobbinRemote, normalizeMobbinResult, type MobbinRemote } from '../src/tools/mobbin';
import { MobbinAuth, withMobbinLock } from '../src/integrations/mobbin';
import { createClientServerPair } from '../src/lib/mcp';
import { renderMessage } from '../src/server/styling';
import { isReferenceImage } from '../src/lib/images';
import schemas from './fixtures/mobbin-tools.json';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';

function fake(label: string) {
  let closed = 0;
  const calls: unknown[] = [];
  const remote: MobbinRemote = {
    listTools: async () => [...schemas as unknown as Tool[], {name:'delete_collection',inputSchema:{type:'object'}}],
    callTool: async (name,args) => { calls.push({name,args}); return {content:[{type:'image',data:png,mimeType:'image/png'}],structuredContent:{label,mobbin_url:'https://mobbin.com/screens/test'}}; },
    close: async () => {closed++;},
  };
  return {remote,calls,closed:()=>closed};
}

test('MCP bridge discovers only search tools, preserves schemas, forwards JPEG and isolates results', async () => {
  const a=fake('a'),b=fake('b');
  const sa=createMobbinServer(a.remote),sb=createMobbinServer(b.remote);
  const [ca]=await createClientServerPair(sa),[cb]=await createClientServerPair(sb);
  try {
    const tools=(await ca.listTools()).tools;
    assert.deepEqual(tools.map(t=>t.name),schemas.map(t=>t.name));
    assert.deepEqual(tools[0].inputSchema.required,['query','platform']);
    assert.deepEqual((tools[0].inputSchema.properties!.image_format as any).enum,['jpg']);
    for(const name of schemas.map(t=>t.name)) {
      const result:any=await ca.callTool({name,arguments:{query:'video discovery',platform:'ios'}});
      assert.equal(result.content[0].data,png);
      assert.match(result.content[1].text,/"label":"a"/);
      const saved=JSON.parse(JSON.stringify(result)); // Same JSON representation persisted by messages.
      const html=renderMessage({role:'user',content:[{type:'tool_result',toolUseId:'x',toolUseName:'mobbin-'+name,isError:false,content:saved.content}]},0);
      assert.match(html,/data:image\/png;base64/);
      assert.match(html,/https:\/\/mobbin.com\/screens\/test/);
    }
    assert.ok(a.calls.every((c:any)=>c.args.image_format==='jpg'));
    const other:any=await cb.callTool({name:'search_screens',arguments:{query:'test',platform:'ios'}});
    assert.match(other.content[1].text,/"label":"b"/);
    const denied:any=await ca.callTool({name:'delete_collection',arguments:{}});
    assert.equal(denied.isError,true); assert.equal(a.calls.length,3);
    await sa.close(); await sa.close(); assert.equal(a.closed(),1);
  } finally {await sa.close();await sb.close();await ca.close();await cb.close();}
});

test('bridge redacts remote exceptions, rejects unsafe or oversized images, and preserves errors/empty results', async () => {
  assert.throws(()=>normalizeMobbinResult({content:[{type:'image',mimeType:'image/svg+xml',data:png}]}));
  assert.throws(()=>normalizeMobbinResult({content:[{type:'text',text:'x'.repeat(131073)}]}));
  assert.equal(normalizeMobbinResult({isError:true,content:[{type:'text',text:'No access'}]}).isError,true);
  assert.match(JSON.stringify(normalizeMobbinResult({content:[],structuredContent:{screens:[]}})),/screens/);
  const f=fake('x');f.remote.callTool=async()=>{throw new Error('secret-token');};
  const s=createMobbinServer(f.remote),[c]=await createClientServerPair(s);
  try {const r:any=await c.callTool({name:'search_screens',arguments:{query:'x',platform:'ios'}});assert.equal(r.isError,true);assert.doesNotMatch(JSON.stringify(r),/secret-token/);}
  finally {await s.close();await c.close();}
});

test('credential writes are private and atomic; missing credentials never initiate login or network', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mobbin-auth-'));
  try {
    let network=0;
    const r=createMobbinRemote({directory:dir,fetch:async()=>{network++;throw new Error('unexpected');}});
    await assert.rejects(r.listTools(),/mobbin login/); assert.equal(network,0);
    await withMobbinLock(async()=>{const a=await new MobbinAuth(dir).load();await a.saveTokens({access_token:'secret',token_type:'Bearer'});},dir);
    assert.equal((await stat(join(dir,'credentials.json'))).mode & 0o777,0o600);
    const a=await new MobbinAuth(dir).load();assert.equal(a.tokens()?.access_token,'secret');
    assert.throws(()=>a.redirectToAuthorization(new URL('https://example.com')),/mobbin login/);
    const events:number[]=[];
    await Promise.all([1,2].map(i=>withMobbinLock(async()=>{events.push(i);await new Promise(r=>setTimeout(r,10));events.push(i);},dir)));
    assert.equal(events.length,4); assert.equal(events[0],events[1]); assert.equal(events[2],events[3]); assert.notEqual(events[0],events[2]);
    await r.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('actual SDK refreshes once for two clients, persists rotated tokens and closes transports', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mobbin-refresh-'));
  const base='https://mobbin.test'; let refreshes=0; let deleted=0;
  const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
  const fetchMock:typeof fetch=async(input,init)=>{
    const url=String(input);const headers=new Headers(init?.headers);
    if(url.includes('oauth-protected-resource'))return json({resource:base+'/mcp',authorization_servers:[base],scopes_supported:['openid']});
    if(url.includes('oauth-authorization-server'))return json({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256']});
    if(url===base+'/token'){refreshes++;assert.match(String(init?.body),/refresh_token=rotate/);return json({access_token:'new',refresh_token:'rotated',token_type:'Bearer',expires_in:3600});}
    if(headers.get('authorization')!=='Bearer new')return new Response('',{status:401,headers:{'WWW-Authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`}});
    if(init?.method==='GET')return new Response(null,{status:405});
    if(init?.method==='DELETE'){deleted++;return new Response(null,{status:200});}
    const msg=JSON.parse(String(init?.body));
    if(!('id' in msg))return new Response(null,{status:202});
    if(msg.method==='initialize')return json({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'mobbin',version:'1'}}},200,{'mcp-session-id':'test'});
    if(msg.method==='tools/list')return json({jsonrpc:'2.0',id:msg.id,result:{tools:schemas}});
    throw new Error('Unexpected request');
  };
  try {
    await withMobbinLock(async()=>{const a=await new MobbinAuth(dir).load();await a.saveClientInformation({client_id:'test',issuer:base});await a.saveTokens({access_token:'old',refresh_token:'rotate',token_type:'Bearer',issuer:base});},dir);
    const a=createMobbinRemote({url:new URL(base+'/mcp'),directory:dir,fetch:fetchMock}),b=createMobbinRemote({url:new URL(base+'/mcp'),directory:dir,fetch:fetchMock});
    const results=await Promise.all([a.listTools(),b.listTools()]);
    assert.equal(results[0].length,3);assert.equal(results[1].length,3);assert.equal(refreshes,1);assert.equal(deleted,2);
    assert.equal(JSON.parse(await readFile(join(dir,'credentials.json'),'utf8')).tokens.refresh_token,'rotated');
    await a.close();await b.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('JPEG previews survive serialization and render with their MIME type; malformed images are rejected', () => {
  const jpeg = "/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==";
  assert.ok(isReferenceImage(jpeg,'image/jpeg'));
  assert.equal(isReferenceImage(jpeg,'image/svg+xml'),false);
  assert.equal(isReferenceImage(jpeg.slice(0,20),'image/jpeg'),false);
  const result=normalizeMobbinResult({content:[{type:'image',mimeType:'image/jpeg',data:jpeg}]});
  const html=renderMessage({role:'user',content:[{type:'tool_result',toolUseId:'jpeg',toolUseName:'mobbin-search_screens',isError:false,content:JSON.parse(JSON.stringify(result.content))}]},0);
  assert.match(html,/src="data:image\/jpeg;base64,/);
});
