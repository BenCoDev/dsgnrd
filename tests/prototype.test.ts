import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createClientServerPair } from '../src/lib/mcp';
import { prototypeRoot, savePrototype, readPrototype } from '../src/integrations/prototype';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsgnrd-prototype-')));
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
process.env.DSGNRD_PROTOTYPES_DIR = join(directory, 'prototypes');
const setup = Promise.all([import('../src/db'), import('../src/db/schema'), import('../src/tools/prototype'), import('../src/server')]);
const input = { title: 'Adapt today', html: '<main><h1>Today’s session</h1><label>Minutes <input id="minutes" value="20"></label><button id="apply">Use today</button><p id="result">Original plan</p><button id="undo">Undo</button></main>',
  css: 'body{margin:24px;font:16px system-ui;background:#101419;color:#fff}button,input{min-height:44px;margin:8px}button{background:#d7f257;color:#111;border:0;border-radius:12px;padding:12px}main{max-width:500px}button:focus-visible{outline:3px solid white}@media(prefers-reduced-motion:reduce){*{animation:none!important}}',
  javascript: 'document.querySelector("#apply").onclick=()=>document.querySelector("#result").textContent="Applied for "+document.querySelector("#minutes").value+" minutes";document.querySelector("#undo").onclick=()=>document.querySelector("#result").textContent="Original plan";' };
let count = 0;
async function fixture() {
  const [{ db }, schema, { createPrototypeServer }, { createApp }] = await setup;
  migrate(db, { migrationsFolder: 'src/migrations' });
  const exp = db.insert(schema.experiments).values({ name: `prototype-${++count}`, problem: 'unused' }).returning().get();
  const other = db.insert(schema.experiments).values({ name: `other-${count}`, problem: 'unused' }).returning().get();
  const make = (experiment: number, name: string) => db.insert(schema.agents).values({ experiment, name, provider: 'anthropic', model: 'claude-haiku-4-5', profile: 'design-web-finisher', thinking: 'none' }).returning().get();
  const author = make(exp.id, 'author'), peer = make(exp.id, 'peer'), foreign = make(other.id, 'foreign');
  const server = createPrototypeServer(exp.id, author.id), reviewer = createPrototypeServer(exp.id, peer.id, { readOnly: true });
  const [client] = await createClientServerPair(server), [review] = await createClientServerPair(reviewer);
  const call = async (name: string, args: Record<string, unknown>, who = client): Promise<any> => who.callTool({ name, arguments: args });
  return { db, schema, exp, author, peer, foreign, app: createApp(), createApp, call, review, client,
    close: async () => { await server.close(); await reviewer.close(); await client.close(); await review.close(); } };
}
function data(result: any) { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); }

test('immutable artifacts, targeted edits, peer reads, read-only review and experiment boundaries', async () => {
  const f = await fixture();
  try {
    const first = data(await f.call('save', input));
    assert.deepEqual(data(await f.call('save', input)), first);
    const edited = data(await f.call('edit', { revision: first.revision, file: 'html', oldText: 'Today’s session', newText: 'Your session' }));
    assert.notEqual(first.revision, edited.revision);
    assert.match(data(await f.call('read', { revision: first.revision, file: 'html' })).content, /Today’s session/);
    assert.match(data(await f.call('read', { author: f.author.id, revision: edited.revision, file: 'html' }, f.review)).content, /Your session/);
    assert.equal((await f.call('edit', { revision: edited.revision, file: 'html', oldText: '<', newText: 'x' })).isError, true);
    assert.equal((await f.call('read', { author: f.foreign.id, revision: first.revision, file: 'html' })).isError, true);
    assert.equal((await f.call('read', { revision: '../../escape', file: 'html' })).isError, true);
    assert.equal(data(await f.call('save', { ...input, author: f.peer.id })).author, f.author.id);
    const names = (await f.review.listTools()).tools.map(t => t.name);
    assert.ok(!names.includes('save') && !names.includes('edit'));
    const { getAgentProfile } = await import('../src/agent_profile');
    for (const name of ['design-web-finisher', 'design-web-reviewer']) assert.ok((await getAgentProfile(name)).isOk());
  } finally { await f.close(); }
});

test('artifact corruption and symlinks cannot substitute another revision', async () => {
  const f = await fixture();
  try {
    const first = savePrototype(f.exp.id, f.author.id, input);
    const file = join(prototypeRoot(), String(f.exp.id), String(f.author.id), `${first.revision}.json`);
    writeFileSync(file, JSON.stringify({ ...input, title: 'tampered' }));
    assert.throws(() => readPrototype(f.exp.id, f.author.id, first.revision), /hash mismatch/);
    rmSync(file); symlinkSync(join(directory, 'test.sqlite'), file);
    assert.throws(() => readPrototype(f.exp.id, f.author.id, first.revision));
    assert.throws(() => savePrototype(f.exp.id, f.author.id, input));
  } finally { await f.close(); }
});

test('standard Runner loads both web profiles and enforces reviewer tool restrictions without model calls', async () => {
  const f = await fixture();
  const previous = process.env.ANTHROPIC_API_KEY;
  const fetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'offline-test-placeholder';
  globalThis.fetch = async () => { throw new Error('No network calls permitted in runner wiring test.'); };
  try {
    const [{ AgentResource }, { ExperimentResource }, { Runner }] = await Promise.all([import('../src/resources/agent'), import('../src/resources/experiment'), import('../src/runner')]);
    const found = await ExperimentResource.findById(f.exp.id); assert.ok(found.isOk());
    for (const profile of ['design-web-finisher', 'design-web-reviewer']) {
      const agent = await AgentResource.create(found.value, { name: profile, profile, provider: 'anthropic', model: 'claude-haiku-4-5', thinking: 'none' }, { system: 'Offline tool wiring test.' });
      const result = await Runner.builder(found.value, agent, { reviewers: 1 });
      assert.ok(result.isOk(), result.isErr() ? result.error.message : '');
      try {
        // Route through Runner without asking Mobbin to discover remote tools.
        const listed = await result.value.executeTool({ type: 'tool_use', id: 'list', name: 'prototype-list', input: {}, provider: null });
        assert.ok(!listed.isError);
        const written = await result.value.executeTool({ type: 'tool_use', id: 'save', name: 'prototype-save', input, provider: null });
        assert.equal(!!written.isError, profile === 'design-web-reviewer');
      } finally { await result.value.close(); }
    }
  } finally { globalThis.fetch = fetch; if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; await f.close(); }
});

test('server preview is sandboxed, authenticated, immutable and experiment-scoped; publication shows only prior evidence', async () => {
  const f = await fixture();
  try {
    const saved = data(await f.call('save', { ...input, title: '"><script>parent.pwned=true</script>' }));
    const response = await f.app.request(saved.previewPath);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.match(html, /sandbox="allow-scripts"/); assert.doesNotMatch(html, /allow-same-origin/);
    assert.doesNotMatch(html, /<script>parent.pwned/);
    assert.equal((await f.app.request(saved.previewPath.replace(`/prototypes/${f.author.id}/`, `/prototypes/${f.foreign.id}/`))).status, 404);
    assert.equal((await f.createApp({ username: 'ben', password: 'test' }).request(saved.previewPath)).status, 401);
    const { renderPrototypePreviews } = await import('../src/server/prototype_previews');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';
    const created = new Date('2026-10-16T12:00:00Z');
    const record = (position: number, inspectedAt: string, revision = saved.revision) => f.db.insert(f.schema.messages).values({ experiment: f.exp.id, agent: f.author.id, role: 'user', position,
      content: [{ type: 'tool_result', toolUseId: `call-${position}`, toolUseName: 'prototype-inspect', isError: false, content: [
        { type: 'text', text: JSON.stringify({ ...saved, revision, viewport: { width: 390, height: 844 }, inspectedAt }) }, { type: 'image', data: png, mimeType: 'image/png' },
      ] }] }).run();
    record(0, '2026-10-16T11:59:00Z');
    const publication = { content: `[Prototype](${saved.previewPath})`, created };
    assert.match(renderPrototypePreviews(f.exp.id, publication), /Open interactive prototype/);
    assert.equal(renderPrototypePreviews(f.exp.id, { ...publication, content: 'no prototype cited' }), '');
    record(1, '2026-10-16T12:02:00Z', 'a'.repeat(64));
    assert.equal(renderPrototypePreviews(f.exp.id, { ...publication, content: saved.previewPath.replace(saved.revision, 'a'.repeat(64)) }), '');
  } finally { await f.close(); }
});

test('real Chromium: responsive render, apply/undo, typing, keyboard, stale actions, isolation and reduced motion', { skip: process.env.DSGNRD_TEST_PROTOTYPE_BROWSER !== '1', timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const saved = data(await f.call('save', { ...input, javascript: input.javascript + `
      try { parent.document.body.dataset.escaped='yes'; } catch { document.body.dataset.isolated='yes'; }
      document.body.insertAdjacentHTML('beforeend','<p>Isolation '+document.body.dataset.isolated+'</p>');
      fetch('http://127.0.0.1:1337/private').catch(()=>{});
      document.body.insertAdjacentHTML('beforeend','<p id="motion">Motion '+(matchMedia('(prefers-reduced-motion:reduce)').matches?'reduced':'normal')+'</p>');` }));
    const first = await f.call('inspect', { revision: saved.revision, viewport: { width: 390, height: 844 } });
    let view = data(first);
    assert.equal(first.content[1].mimeType, 'image/png');
    assert.ok(Buffer.from(first.content[1].data, 'base64').length > 1000);
    assert.equal(view.diagnostics.horizontalOverflow, false);
    assert.match(view.text, /Motion normal/);
    assert.match(view.text, /Isolation yes/);
    assert.ok(view.errors.some((e: string) => /Content Security Policy|connect-src|violat/i.test(e)));
    view = data(await f.call('act', { session: view.session, observation: view.observation, action: { type: 'fill', selector: '#minutes', value: '15' } }));
    const stale = { session: view.session, observation: view.observation };
    view = data(await f.call('act', { ...stale, action: { type: 'click', selector: '#apply' } }));
    assert.match(view.text, /Applied for 15 minutes/);
    assert.equal((await f.call('act', { ...stale, action: { type: 'click', selector: '#undo' } })).isError, true);
    const concurrent = await Promise.all([1, 2].map(() => f.call('act', { session: view.session, observation: view.observation, action: { type: 'click', selector: '#undo' } })));
    assert.equal(concurrent.filter(r => r.isError).length, 1);
    view = data(concurrent.find(r => !r.isError)); assert.match(view.text, /Original plan/);
    view = data(await f.call('act', { session: view.session, observation: view.observation, action: { type: 'press', key: 'Shift+Tab' } }));
    assert.ok(view.diagnostics.controls.some((c: any) => c.id === 'apply' && c.focused));
    const narrow = data(await f.call('inspect', { revision: saved.revision, viewport: { width: 320, height: 700 }, reducedMotion: true }));
    assert.match(narrow.text, /Motion reduced/); assert.equal(narrow.diagnostics.horizontalOverflow, false);
    const peer = data(await f.call('inspect', { author: f.author.id, revision: saved.revision }, f.review));
    assert.match(peer.text, /Original plan/);
    assert.equal((await f.call('act', { session: narrow.session, observation: narrow.observation, action: { type: 'click', selector: '#apply' } }, f.review)).isError, true);
    const { mkdirSync } = await import('node:fs');
    if (process.env.DSGNRD_TEST_EVIDENCE_DIR) {
      mkdirSync(process.env.DSGNRD_TEST_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.DSGNRD_TEST_EVIDENCE_DIR, 'prototype.png'), Buffer.from(first.content[1].data, 'base64'));
    }
  } finally { await f.close(); }
});

after(async () => { const [{ db }] = await setup; db.$client.close(); rmSync(directory, { recursive: true, force: true }); });
