// Explicit live fixture: real Figma/MCP/runner/storage, deterministic model, no paid calls.
// Use a NEW isolated DATABASE_PATH; this script creates two agents and native frames.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Message, Tool, TokenUsage } from '../src/models';

async function main() {
  if (!process.env.DATABASE_PATH || existsSync(process.env.DATABASE_PATH)) throw new Error('Provide a new isolated DATABASE_PATH.');
  if (!process.env.DSGNRD_FIGMA_SERVER) throw new Error('Set DSGNRD_FIGMA_SERVER.');
  const [{ db }, schema, { migrate }, { ExperimentResource }, { AgentResource }, { Runner }, { Advisory }, { LLM }, { ok }, { createServer }, { createClientServerPair }, { configureFigma }, { getAgentProfile }, { eq }] = await Promise.all([
    import('../src/db'), import('../src/db/schema'), import('drizzle-orm/better-sqlite3/migrator'),
    import('../src/resources/experiment'), import('../src/resources/agent'), import('../src/runner'), import('../src/runner/advisory'),
    import('../src/models'), import('../src/lib/error'), import('../src/tools'), import('../src/lib/mcp'), import('../src/resources/figma'), import('../src/agent_profile'), import('drizzle-orm'),
  ]);
  migrate(db, { migrationsFolder: resolve('src/migrations') });
  const experiment = await ExperimentResource.create({ name: 'figma-collaboration-proof', problem: 'oldskaters/trick-reveal' });
  configureFigma(experiment.toJSON().id, 'VEo8vKvbwyh7YiEnXbGkAj', '0:1');
  const profile = await getAgentProfile('design-figma'); assert.ok(profile.isOk());
  const author = await AgentResource.create(experiment, { name: 'author', model: 'claude-haiku-4-5', provider: 'anthropic', thinking: 'none', profile: 'design-figma' }, { system: profile.value.prompt });
  const peer = await AgentResource.create(experiment, { name: 'peer', model: 'claude-haiku-4-5', provider: 'anthropic', thinking: 'none', profile: 'design-figma' }, { system: profile.value.prompt });
  Advisory.register(['author', 'peer']);
  class ScriptedModel extends LLM {
    next!: Message;
    seen: Message[] = [];
    constructor() { super({}); }
    async tokens() { return ok(100); }
    maxTokens() { return 100000; }
    protected costPerTokenUsage(_usage: TokenUsage) { return 0; }
    async run(messages: Message[], _prompt: string, _choice: unknown, tools: Tool[]) {
      assert.ok(tools.some(t => t.name === 'figma-create_proposal'));
      this.seen = messages;
      return ok({ message: this.next, tokenUsage: { total: 0, input: 0, output: 0, cached: 0, thinking: 0 } });
    }
  }
  const connections: { server: Awaited<ReturnType<typeof createServer>>; client: Awaited<ReturnType<typeof createClientServerPair>>[0] }[] = [];
  async function runner(agent: typeof author) {
    const clients = [];
    for (const tool of ['figma', 'publications', 'goal_solution'] as const) {
      const server = await createServer(tool, { experiment, agent, config: { reviewers: 1 } });
      const [client] = await createClientServerPair(server);
      connections.push({ server, client }); clients.push(client);
    }
    const model = new ScriptedModel();
    const initialized = await Runner.initialize(experiment, agent, clients, model); assert.ok(initialized.isOk());
    return { runner: initialized.value, model, agent };
  }
  function lastResult(agent: typeof author): any {
    const rows = db.select().from(schema.messages).where(eq(schema.messages.agent, agent.toJSON().id)).all();
    const results = rows.flatMap(row => row.content).filter(item => item.type === 'tool_result');
    const result = results.at(-1); assert.ok(result); assert.equal(result.isError, false, JSON.stringify(result)); return result;
  }
  async function tick(context: Awaited<ReturnType<typeof runner>>, name: string, input: object) {
    context.model.next = { role: 'agent', content: [{ type: 'tool_use', id: crypto.randomUUID(), name, input, provider: null }] };
    const result = await context.runner.tick(); if (result.isErr()) throw result.error; return lastResult(context.agent);
  }
  const directory = resolve('docs/figma-proof/collaboration'); await mkdir(directory, { recursive: true });
  async function save(label: string, result: any) {
    const img = result.content.find((c: any) => c.type === 'image'); assert.ok(img);
    await writeFile(`${directory}/${label}.png`, Buffer.from(img.data, 'base64'));
    const data = JSON.parse(result.content.find((c: any) => c.type === 'text').text);
    await writeFile(`${directory}/${label}.json`, JSON.stringify(data, null, 2)); return data;
  }
  const scene = {
    title: 'Oldskaters / trick reveal', width: 390, height: 480, background: '#F8F7F4', elements: [
      { type: 'text', name: 'Brand', x: 24, y: 24, width: 340, height: 32, text: 'OLDSKATERS', color: '#202020', fontSize: 16, bold: true },
      { type: 'text', name: 'Title', x: 24, y: 90, width: 340, height: 92, text: 'Your next trick\nstarts here.', color: '#202020', fontSize: 34, bold: true },
      { type: 'rectangle', name: 'Video placeholder', x: 24, y: 202, width: 342, height: 130, color: '#DFDED8', radius: 12 },
      { type: 'text', name: 'Video label', x: 46, y: 250, width: 300, height: 28, text: 'Watch the trick reveal', color: '#454545', fontSize: 18 },
      { type: 'rectangle', name: 'CTA background', x: 24, y: 374, width: 342, height: 56, color: '#D8D7D1', radius: 12 },
      { type: 'text', name: 'CTA label', x: 46, y: 391, width: 300, height: 26, text: 'Try this trick', color: '#202020', fontSize: 18, bold: true },
    ],
  };
  try {
    const a = await runner(author), b = await runner(peer);
    const first = await tick(a, 'figma-create_proposal', { operationKey: 'author-v1', scene });
    const firstData = await save('author-v1', first);
    const alternative = await tick(b, 'figma-create_proposal', { operationKey: 'peer-v1', scene: { ...scene, title: 'Peer / alternate direction', background: '#E8F0F4' } });
    const alternativeData = await save('peer-v1', alternative); assert.notEqual(firstData.frameId, alternativeData.frameId);
    await tick(a, 'publications-submit_publication', { title: 'Trick reveal proposal', abstract: 'Editable frame, revision 1.', content: `Proposal: ${firstData.url}\nInspected revision 1. Explore a simple video-first trick reveal.` });
    const publication = db.select().from(schema.publications).all()[0];
    const observed = await tick(b, 'figma-inspect_proposal', { frameId: firstData.frameId });
    await save('peer-observation-v1', observed);
    await tick(b, 'publications-submit_review', { publication: publication.reference, grade: 'ACCEPT', content: `Inspected revision 1 at ${firstData.url}. Increase emphasis on the Try this trick action so it is clearer below the video.` });
    await tick(a, 'publications-get_publication', { reference: publication.reference });
    const revision = { ...scene, elements: scene.elements.map(e => e.name === 'CTA background' ? { ...e, color: '#5429CC' } : e.name === 'CTA label' ? { ...e, color: '#FFFFFF' } : e) };
    const revised = await tick(a, 'figma-revise_proposal', { operationKey: 'author-v2', frameId: firstData.frameId, revision: 1, scene: revision });
    const revisedData = await save('author-v2', revised); assert.equal(revisedData.frameId, firstData.frameId); assert.equal(revisedData.revision, 2);
    const peerRows = db.select().from(schema.messages).where(eq(schema.messages.agent, peer.toJSON().id)).all();
    assert.ok(peerRows.some(row => JSON.stringify(row.content).includes(observed.content.find((c: any) => c.type === 'image').data)));
    assert.notEqual(first.content.find((c: any) => c.type === 'image').data, revised.content.find((c: any) => c.type === 'image').data);
    await tick(a, 'publications-submit_publication', { title: 'Trick reveal revision', abstract: 'Revision 2 responds to peer feedback.', content: `Updated ${revisedData.url}, inspected revision 2. The primary action now has a stronger purple background and white label.` });
    const second = db.select().from(schema.publications).all().at(-1)!;
    await tick(b, 'figma-inspect_proposal', { frameId: firstData.frameId });
    await tick(b, 'publications-submit_review', { publication: second.reference, grade: 'ACCEPT', content: 'Inspected revision 2. The primary action has stronger visual emphasis.' });
    const report = { experiment: experiment.toJSON().name, database: process.env.DATABASE_PATH, author: firstData.url, peer: alternativeData.url, finalRevision: 2, publications: db.select().from(schema.publications).all().map(p => ({ reference: p.reference, status: p.status })), reviews: db.select().from(schema.reviews).all().map(r => ({ grade: r.grade, content: r.content })), paidModelCalls: 0, fixture: 'Deterministic responses through the real runner; not a model-quality evaluation.' };
    await writeFile(`${directory}/result.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const { server, client } of connections) { await server.close(); await client.close(); }
    db.$client.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
