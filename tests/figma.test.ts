import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createClientServerPair } from '../src/lib/mcp';
import { isNonDefaultToolName } from '../src/tools/constants';
import type { FigmaRemote } from '../src/integrations/figma';

const directory = mkdtempSync(join(tmpdir(), 'dsgnrd-figma-test-'));
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
process.env.DSGNRD_FIGMA_DIR = join(directory, 'locks');
// These imports must follow DATABASE_PATH, so no real experiment database is touched.
const setup = Promise.all([import('../src/tools/figma'), import('../src/resources/figma'), import('../src/db'), import('../src/db/schema')]);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';
const scene = { title: 'Proposal', width: 400, height: 200, background: '#FFFFFF', elements: [{ type: 'text', name: 'Heading', x: 20, y: 20, width: 300, height: 60, text: 'Hello', color: '#111111' }] };

function canvasFixture() {
  let sequence = 1;
  const nodes = new Map<string, any>();
  function node(type: string) {
    const data = new Map();
    const n: any = { id: `1:${sequence++}`, type, name: '', x: 0, y: 0, width: 100, height: 100, children: [],
      getPluginData: (k: string) => data.get(k) || '', setPluginData: (k: string, v: string) => data.set(k, v),
      appendChild(child: any) { if (child.parent) child.parent.children = child.parent.children.filter((x: any) => x !== child); child.parent = n; n.children.push(child); },
      resize(w: number, h: number) { n.width = w; n.height = h; }, resizeWithoutConstraints(w: number, h: number) { n.resize(w, h); },
      remove() { n.parent.children = n.parent.children.filter((x: any) => x !== n); nodes.delete(n.id); },
      exportAsync: async () => Buffer.from(png, 'base64'),
    };
    nodes.set(n.id, n); return n;
  }
  const page = node('PAGE'); nodes.delete(page.id); page.id = '0:1'; nodes.set(page.id, page);
  const figma: any = { fileKey: 'TestFile', getNodeByIdAsync: async (id: string) => nodes.get(id), loadFontAsync: async () => {}, base64Encode: (b: Buffer) => b.toString('base64') };
  for (const [method, type] of Object.entries({ createSection: 'SECTION', createFrame: 'FRAME', createText: 'TEXT', createRectangle: 'RECTANGLE' })) figma[method] = () => { const n = node(type); page.appendChild(n); return n; };
  let failAfterWrite = false, disconnected = false, executions = 0;
  const remote: FigmaRemote = { execute: async (fileKey, code) => {
    executions++;
    assert.equal(fileKey, 'TestFile');
    if (disconnected) throw new Error('Disconnected');
    let result;
    try { result = await runInNewContext(`(async () => { ${code} })()`, { figma }, { timeout: 1000 }); }
    catch (error) { throw new Error(String(error)); }
    if (failAfterWrite && result?.operation) { failAfterWrite = false; throw new Error('Timed out after committing canvas write'); }
    return result;
  }, close: async () => {} };
  return { remote, page, figma, node, nodes, executions: () => executions, timeout: () => { failAfterWrite = true; }, disconnect: () => { disconnected = true; } };
}
let expCounter = 0;
async function fixture() {
  const [{ createFigmaServer }, { configureFigma, figmaStore }, { db }, schema] = await setup;
  migrate(db, { migrationsFolder: 'src/migrations' });
  const experiment = db.insert(schema.experiments).values({ name: `figma-${++expCounter}`, problem: 'problems/oldskaters/trick-reveal' }).returning().get();
  const agents = ['author', 'peer'].map(name => db.insert(schema.agents).values({ experiment: experiment.id, name, profile: 'design-figma', provider: 'anthropic', model: 'claude-haiku-4-5', thinking: 'none' }).returning().get());
  const destination = configureFigma(experiment.id, 'TestFile', '0:1');
  const canvas = canvasFixture();
  const servers = agents.map(a => createFigmaServer(experiment.id, a.id, { remote: canvas.remote }));
  const clients = await Promise.all(servers.map(async s => (await createClientServerPair(s))[0]));
  const call = async (who: number, name: string, args: Record<string, unknown> = {}) => clients[who].callTool({ name, arguments: args }) as Promise<any>;
  const close = async () => { await Promise.all(servers.map(s => s.close())); await Promise.all(clients.map(c => c.close())); };
  return { call, close, clients, servers, canvas, destination, experiment, agents, store: figmaStore, configureFigma, createFigmaServer };
}
function evidence(result: any) { assert.equal(result.isError, false, JSON.stringify(result)); return JSON.parse(result.content[0].text); }

test('profile discovery, scoped creation, peer reads, revision conflicts, and unrelated content protection', async () => {
  const f = await fixture();
  try {
    assert.equal(isNonDefaultToolName('figma'), true);
    assert.equal((await f.clients[0].listTools()).tools.length, 5);
    const unrelated = f.canvas.node('RECTANGLE'); unrelated.name = 'Human work'; unrelated.y = 1000; f.canvas.page.appendChild(unrelated);
    const created = evidence(await f.call(0, 'create_proposal', { operationKey: 'one', scene }));
    const peer = evidence(await f.call(1, 'create_proposal', { operationKey: 'one', scene }));
    assert.notEqual(created.frameId, peer.frameId);
    const ownFrame = f.canvas.nodes.get(created.frameId);
    assert.ok(ownFrame.parent.y > unrelated.y + unrelated.height);
    assert.ok(f.canvas.nodes.get(peer.frameId).parent.y > ownFrame.parent.y + ownFrame.parent.height);
    assert.equal(evidence(await f.call(1, 'inspect_proposal', { frameId: created.frameId })).owner, f.agents[0].id);
    assert.equal((await f.call(1, 'revise_proposal', { operationKey: 'steal', frameId: created.frameId, revision: 1, scene })).isError, true);
    assert.equal(f.store.pending(f.experiment.id).length, 0); // Invalid writes never create pending intent.
    assert.equal((await f.call(0, 'inspect_proposal', { frameId: unrelated.id })).isError, true);
    const revised = evidence(await f.call(0, 'revise_proposal', { operationKey: 'revise', frameId: created.frameId, revision: 1, scene: { ...scene, title: 'Revision' } }));
    assert.equal(revised.revision, 2);
    assert.equal((await f.call(0, 'revise_proposal', { operationKey: 'stale', frameId: created.frameId, revision: 1, scene })).isError, true);
    ownFrame.appendChild(f.canvas.node('TEXT'));
    assert.equal((await f.call(0, 'revise_proposal', { operationKey: 'unrelated', frameId: created.frameId, revision: 2, scene })).isError, true);
    assert.equal(unrelated.name, 'Human work');
    assert.throws(() => f.configureFigma(f.experiment.id, 'Other', '0:1'), /different/);
  } finally { await f.close(); }
});

test('lost write response survives server restart, reconciles destination, and replays original saved evidence', async () => {
  const f = await fixture();
  try {
    f.canvas.timeout();
    const lost = await f.call(0, 'create_proposal', { operationKey: 'lost', scene });
    assert.equal(lost.isError, true); assert.match(lost.content[0].text, /pending/);
    assert.equal(f.canvas.page.children.length, 1);
    const count = f.canvas.executions();
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'lost', scene })).isError, true);
    assert.equal((await f.call(1, 'create_proposal', { operationKey: 'different', scene })).isError, true);
    assert.equal(f.canvas.executions(), count);
    await f.servers[0].close();
    const server = f.createFigmaServer(f.experiment.id, f.agents[0].id, { remote: f.canvas.remote });
    const [client] = await createClientServerPair(server);
    try {
      const reconciled: any = await client.callTool({ name: 'reconcile_operation', arguments: { operationKey: 'lost' } });
      const data = evidence(reconciled); assert.equal(data.revision, 1);
      const revised: any = await client.callTool({ name: 'revise_proposal', arguments: { operationKey: 'revision', frameId: data.frameId, revision: 1, scene: { ...scene, title: 'Changed' } } });
      evidence(revised);
      const replay = await client.callTool({ name: 'create_proposal', arguments: { operationKey: 'lost', scene } });
      assert.deepEqual(replay, reconciled); // Immutable screenshot and inspection timestamp.
      assert.equal(f.canvas.page.children.length, 1);
      assert.equal(f.store.pending(f.experiment.id).length, 0);
    } finally { await server.close(); await client.close(); }
  } finally { await f.close(); }
});

test('wrong file/page, malformed input, and disconnected preflight fail without writes', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'bad', scene: { ...scene, elements: [{ ...scene.elements[0], x: 2000 }] } })).isError, true);
    f.canvas.figma.fileKey = 'Other';
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'wrong', scene })).isError, true);
    f.canvas.figma.fileKey = 'TestFile';
    f.canvas.nodes.delete('0:1');
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'page', scene })).isError, true);
    f.canvas.disconnect();
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'offline', scene })).isError, true);
    assert.equal(f.store.pending(f.experiment.id).length, 0);
    assert.equal(f.canvas.page.children.length, 0);
  } finally { await f.close(); }
});

test('unresolved partial mutation is not retried, and structured strings cannot execute code', async () => {
  const f = await fixture();
  try {
    const text = `'); throw new Error('injected'); //`;
    const created = evidence(await f.call(0, 'create_proposal', { operationKey: 'quoted', scene: { ...scene, elements: [{ ...scene.elements[0], text }] } }));
    assert.equal(created.layers[0].text, text);
    const pending = f.store.begin(f.experiment.id, f.agents[0].id, 'partial', JSON.stringify({ action: 'create', scene }));
    assert.equal((await f.call(0, 'reconcile_operation', { operationKey: 'partial' })).isError, true);
    assert.equal(f.store.pending(f.experiment.id)[0].id, pending.id);
    assert.equal(f.canvas.page.children.length, 1);
  } finally { await f.close(); }
});

test('concurrent calls with the same operation identity create exactly one proposal', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([1,2].map(() => f.call(0, 'create_proposal', { operationKey: 'same', scene })));
    assert.deepEqual(results[0], results[1]); evidence(results[0]);
    assert.equal(f.canvas.page.children.length, 1);
    assert.equal((await f.call(0, 'create_proposal', { operationKey: 'same', scene: { ...scene, title: 'different' } })).isError, true);
  } finally { await f.close(); }
});

after(async () => { const [, , { db }] = await setup; db.$client.close(); rmSync(directory, { recursive: true, force: true }); });
