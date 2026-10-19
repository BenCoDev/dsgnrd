import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClientServerPair } from '../src/lib/mcp';

test('designated review pool excludes inactive and foreign agents without changing default assignment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsgnrd-review-pool-'));
  process.env.DATABASE_PATH = join(dir, 'test.sqlite');
  const [{ db }, schema, { migrate }, { ExperimentResource }, { AgentResource }, { createPublicationsServer }] = await Promise.all([
    import('../src/db'), import('../src/db/schema'), import('drizzle-orm/better-sqlite3/migrator'),
    import('../src/resources/experiment'), import('../src/resources/agent'), import('../src/tools/publications'),
  ]);
  const { Advisory } = await import('../src/runner/advisory'); Advisory.register();
  migrate(db, { migrationsFolder: 'src/migrations' });
  try {
    const experiment = await ExperimentResource.create({ name:'review-test', problem:'oldskaters/trick-reveal' });
    const other = await ExperimentResource.create({ name:'other', problem:'oldskaters/trick-reveal' });
    const make = (e: typeof experiment, name:string) => AgentResource.create(e, { name, profile:'design', provider:'anthropic', model:'claude-sonnet-5', thinking:'none' }, {system:'Test instructions'});
    const author = await make(experiment,'finisher'), reviewer = await make(experiment,'reviewer');
    const inactive = await make(experiment,'inactive'), foreign = await make(other,'foreign');
    async function submit(reviewerAgentIds?: number[], reviewers=1) {
      const server = await createPublicationsServer(experiment,author,{reviewers,reviewerAgentIds});
      const [client] = await createClientServerPair(server);
      try { return await client.callTool({name:'submit_publication',arguments:{title:'Polish',abstract:'Polish',content:'Polish'}}); }
      finally { await server.close(); await client.close(); }
    }
    const chosen = await submit([reviewer.toJSON().id,foreign.toJSON().id,author.toJSON().id]);
    assert.equal(chosen.isError,false,JSON.stringify(chosen));
    assert.deepEqual(db.select().from(schema.reviews).all().map(r=>r.author),[reviewer.toJSON().id]);
    const invalid = await submit([foreign.toJSON().id,author.toJSON().id]);
    assert.equal(invalid.isError,true);
    assert.equal(db.select().from(schema.publications).all().length,1);
    const defaults = await submit(undefined,2);
    assert.equal(defaults.isError,false);
    assert.deepEqual(db.select().from(schema.reviews).all().slice(1).map(r=>r.author).sort(),[reviewer.toJSON().id,inactive.toJSON().id].sort());
  } finally { db.$client.close(); rmSync(dir,{recursive:true,force:true}); }
});
