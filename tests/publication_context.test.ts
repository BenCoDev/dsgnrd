import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClientServerPair } from '../src/lib/mcp';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';
test('publication context preserves bounded visual evidence, exact boundaries and experiment isolation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsgnrd-context-'));
  process.env.DATABASE_PATH = join(dir, 'test.sqlite');
  const [{ db }, schema, { migrate }, { ExperimentResource }, { AgentResource }, { createPublicationsServer }, { Advisory }] = await Promise.all([
    import('../src/db'), import('../src/db/schema'), import('drizzle-orm/better-sqlite3/migrator'), import('../src/resources/experiment'),
    import('../src/resources/agent'), import('../src/tools/publications'), import('../src/runner/advisory'),
  ]);
  migrate(db, { migrationsFolder:'src/migrations' }); Advisory.register();
  const connections: any[] = [];
  try {
    const experiment = await ExperimentResource.create({name:'context',problem:'oldskaters/trick-reveal'});
    const foreign = await ExperimentResource.create({name:'foreign',problem:'oldskaters/trick-reveal'});
    const make = (e: typeof experiment,name:string) => AgentResource.create(e,{name,profile:'design',provider:'anthropic',model:'claude-sonnet-5',thinking:'none'},{system:'Test'});
    const author = await make(experiment,'explorer'), reader = await make(experiment,'finisher'), other = await make(foreign,'other');
    const clientFor = async (e:typeof experiment,a:typeof author) => { const server=await createPublicationsServer(e,a,{reviewers:0}); const [client]=await createClientServerPair(server); connections.push({server,client}); return client; };
    const writer = await clientFor(experiment,author), client = await clientFor(experiment,reader), outsider = await clientFor(foreign,other);
    const insert = (position:number,content:any[],agent=author,exp=experiment,created=new Date()) => db.insert(schema.messages).values({experiment:exp.toJSON().id,agent:agent.toJSON().id,position,role:'user',content,created}).run();
    insert(0,[{type:'text',text:'DECISION: preserve the shared horizon.',provider:{anthropic:{secret:'PROVIDER_SECRET'}}},{type:'thinking',thinking:'PRIVATE_THINKING',provider:null}]);
    insert(1,[{type:'tool_use',id:'search',name:'mobbin-search',input:{query:'cinematic media'},provider:null}]);
    insert(2,[{type:'tool_result',toolUseId:'search',toolUseName:'mobbin-search',isError:false,content:[
      {type:'text',text:'https://mobbin.com/screens/example\n'+'x'.repeat(40000)},
      ...[1,2,3].map(()=>({type:'image',mimeType:'image/png',data:png})),
      {type:'image',mimeType:'image/png',data:'INVALID_IMAGE'},
    ]}]);
    insert(0,[{type:'text',text:'OTHER_AUTHOR',provider:null}],reader);
    insert(0,[{type:'text',text:'OTHER_EXPERIMENT',provider:null}],other,foreign);
    const submitted:any = await writer.callTool({name:'submit_publication',arguments:{title:'Chosen direction',abstract:'Chosen',content:'Use the shared horizon.'}});
    assert.equal(submitted.isError,false);
    const publication = db.select().from(schema.publications).get()!;
    assert.match(submitted.content[0].text,/Context through position: 2/);
    insert(3,[{type:'tool_result',toolUseId:'publish',toolUseName:'publications-submit_publication',isError:false,content:submitted.content}]);
    // Same-second later work must not leak through a timestamp-only boundary.
    insert(4,[{type:'text',text:'LATER_WORK',provider:null}],author,experiment,publication.created);
    const read = (args:object, c=client) => c.callTool({name:'get_publication_context',arguments:{reference:publication.reference,...args}}) as Promise<any>;
    const collected:any[]=[]; let cursor:any; let pages=0;
    do {
      const result=await read(cursor?{cursor}:{}); assert.equal(result.isError,false,JSON.stringify(result));
      const info=JSON.parse(result.content[0].text);
      assert.equal(info.boundary,'submission_receipt'); assert.equal(info.throughPosition,2);
      assert.ok(result.content.filter((b:any)=>b.type==='image').length<=2);
      assert.ok(Buffer.byteLength(result.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''))<34000);
      collected.push(...result.content.slice(1)); cursor=info.nextCursor; assert.ok(++pages<10);
    } while(cursor);
    assert.ok(pages>=2);
    assert.equal(collected.filter(b=>b.type==='image').length,3);
    assert.ok(collected.filter(b=>b.type==='image').every(b=>b.data===png));
    const text=collected.filter(b=>b.type==='text').map(b=>b.text).join('');
    assert.match(text,/DECISION/); assert.match(text,/mobbin.com\/screens\/example/);
    assert.doesNotMatch(text,/PRIVATE_THINKING|PROVIDER_SECRET|OTHER_AUTHOR|OTHER_EXPERIMENT|LATER_WORK|INVALID_IMAGE/);
    const filtered=await read({toolPrefix:'mobbin-'}); assert.doesNotMatch(JSON.stringify(filtered),/DECISION/);
    assert.equal((await read({},outsider)).isError,true);
    const past=await read({cursor:{position:99,part:0}});assert.equal(JSON.parse(past.content[0].text).nextCursor,null);
    const legacy = db.insert(schema.publications).values({experiment:experiment.toJSON().id,author:author.toJSON().id,reference:'old1',title:'Legacy',abstract:'Old',content:'Old',status:'PUBLISHED',created:new Date(100000)}).returning().get();
    db.$client.prepare('UPDATE messages SET created = 99 WHERE agent = ? AND position = 0').run(author.toJSON().id);
    db.$client.prepare('UPDATE messages SET created = 100 WHERE agent = ? AND position > 0').run(author.toJSON().id);
    const old:any=await client.callTool({name:'get_publication_context',arguments:{reference:legacy.reference}});
    assert.equal(JSON.parse(old.content[0].text).boundary,'legacy_strict_timestamp');
    assert.equal(JSON.parse(old.content[0].text).throughPosition,0);
    assert.doesNotMatch(JSON.stringify(old),/cinematic media|LATER_WORK/);
  } finally { for(const {server,client} of connections){await server.close();await client.close();} db.$client.close();rmSync(dir,{recursive:true,force:true}); }
});
