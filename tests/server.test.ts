import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import Database from "better-sqlite3";

// Each node:test file runs in a separate process; set the DB before importing resources.
const workspace = mkdtempSync(join(tmpdir(), "dsgnrd-ui-"));
process.env.DATABASE_PATH = join(workspace, "test.sqlite");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const database = new Database(process.env.DATABASE_PATH);
for (const file of readdirSync(resolve("src/migrations")).filter(f => f.endsWith(".sql")).sort()) {
  database.exec(readFileSync(resolve("src/migrations", file), "utf8"));
}
const brief = join(workspace, "brief.md");
writeFileSync(brief, "# Design brief\nKeep the crew visible.");
function insert(table: string, fields: Record<string, unknown>) {
  const values = { created: 1700000000, updated: 1700000000, ...fields };
  const names = Object.keys(values);
  return Number(database.prepare(`INSERT INTO ${table} (${names.map(n => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(values)).lastInsertRowid);
}
function executeScript(html: string, selector: string) {
  const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m => m[1].includes(selector))?.[1];
  assert.ok(source, selector);
  const nodes: Record<string, any> = {};
  const context = { document: { getElementById(id: string) { return nodes[id] ??= { textContent: "", innerHTML: "" }; } } };
  runInNewContext(source, context);
  return { nodes, context };
}

test("read-only dashboard: collaboration, evolution, solutions, cost and refresh", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Dashboard must not make network/model calls"); };
  try {
    const { createApp } = await import("../src/server");
    const { prepareChartData, renderMessage, sanitizeMarkdown } = await import("../src/server/styling");
    const app = createApp();
    const read = async (path: string) => {
      const response = await app.request(path);
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return body;
    };
    assert.match(await read("/experiments"), /No experiments yet/);
    assert.equal((await app.request("/")).status, 302);
    const experiment = insert("experiments", { name: "collaboration", problem: brief });
    const other = insert("experiments", { name: "empty", problem: brief });
    const agent = (name: string) => insert("agents", { experiment, name, provider: "anthropic", model: "claude-haiku-4-5", thinking: "low", profile: "design" });
    const author = agent("designer"), critic = agent("critic");
    const base = "Keep <instructions> literal.\nTest proposals.";
    insert("evolutions", { experiment, agent: author, system: base });
    insert("evolutions", { experiment, agent: critic, system: base });
    insert("evolutions", { experiment, agent: author, system: base + "\nDistinguish hypotheses from findings.\n</script><script>alert(1)</script>" });
    const pub = (reference: string, status: string) => insert("publications", { experiment, author, reference, status, title: `Proposal ${reference}`, abstract: "Discovery", content: "# Portraits\n**Reveal** the crew. <script>alert(1)</script>" });
    const first = pub("one", "PUBLISHED"), pending = pub("two", "SUBMITTED");
    insert("citations", { experiment, from: pending, to: first });
    insert("reviews", { experiment, publication: first, author: critic, grade: "ACCEPT", content: "Test discoverability first." });
    insert("reviews", { experiment, publication: pending, author: critic, grade: null, content: null });
    const msg = insert("messages", { experiment, agent: author, position: 85, role: "agent", content: JSON.stringify([{ type: "tool_use", id: "call-1", name: "system_prompt_self_edit-append", input: { content: "Distinguish hypotheses from findings." }, provider: null }]) });
    insert("messages", { experiment, agent: author, position: 86, role: "user", content: JSON.stringify([{ type: "tool_result", toolUseId: "call-1", toolUseName: "system_prompt_self_edit-append", isError: false, content: [{ type: "text", text: "Instructions saved" }] }]) });
    insert("token_usages", { experiment, agent: author, message: msg, input: 1000000, output: 0, total: 1000000, cached: 0, thinking: 0 });
    insert("solutions", { experiment, agent: author, publication: first, reason: "new_approach", content: "Strongest starting hypothesis." });
    insert("solutions", { experiment, agent: author, publication: null, reason: "previous_rejected", content: "Needs more evidence." });
    const snapshot = () => database.serialize().toString("base64");
    const before = snapshot();
    const overview = await read(`/experiments/${experiment}`);
    assert.match(overview, /Design brief/);
    assert.match(overview, /Estimated cost: <strong>\$1\.00/);
    assert.match(await read(`/experiments/${experiment}/agents`), /claude-haiku-4-5/);
    const authorPage = await read(`/experiments/${experiment}/agents/${author}`);
    assert.match(authorPage, /Strongest starting hypothesis/);
    assert.match(authorPage, /Choice withdrawn/);
    assert.match(authorPage, /Position: 85/);
    assert.match(authorPage, /Instructions saved/);
    assert.ok(authorPage.indexOf("Position: 86") < authorPage.indexOf("Position: 85"));
    const evolution = executeScript(authorPage, "let currentEvolutionIndex");
    assert.match(evolution.nodes.diffContent.innerHTML, /diff-added.*Distinguish hypotheses/);
    assert.match(evolution.nodes.fullInstructions.textContent, /<instructions>/);
    assert.match(evolution.nodes.evolutionMeta.textContent, /Saved change/);
    runInNewContext("nextEvolution()", evolution.context);
    assert.equal(evolution.nodes.fullInstructions.textContent, base);
    assert.match(evolution.nodes.evolutionMeta.textContent, /Initial instructions/);
    const criticPage = await read(`/experiments/${experiment}/agents/${critic}`);
    const initial = executeScript(criticPage, "let currentEvolutionIndex");
    assert.match(initial.nodes.diffContent.textContent, /no saved changes yet/);
    assert.equal(initial.nodes.fullInstructions.textContent, base);
    assert.match(criticPage, /No messages yet/);
    const detail = await read(`/experiments/${experiment}/publications/${first}`);
    assert.match(detail, /Test discoverability first/);
    assert.match(detail, /ACCEPT/);
    assert.doesNotMatch(detail, /<script>alert/);
    assert.match(detail, new RegExp(`/publications/${pending}`));
    assert.match(await read(`/experiments/${experiment}/publications/${pending}`), /Assigned — awaiting review/);
    assert.match(await read(`/experiments/${experiment}/publications?status=rejected`), /No publications match/);
    const download = await app.request(`/experiments/${experiment}/publications/${first}/download?reviews=true`);
    assert.match(download.headers.get("content-type")!, /text\/markdown/);
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.match(await download.text(), /Test discoverability first/);
    const solutions = await read(`/experiments/${experiment}/solutions`);
    assert.match(solutions, /Choice withdrawn/);
    assert.match(solutions, /current: 0/);
    assert.match(solutions, /Strongest starting hypothesis/);
    const chart = executeScript(solutions, "const chartData");
    assert.doesNotMatch(chart.nodes.solutionChart.innerHTML, /NaN|Infinity/);
    assert.match(await read(`/experiments/${other}/solutions`), /No solution reports yet/);
    assert.match(await read(`/experiments/${other}/agents`), /No agents yet/);
    for (const path of [`/experiments/${other}/agents/${author}`, `/experiments/${other}/publications/${first}`, `/experiments/${other}/publications/${first}/download`, "/experiments/1oops", "/experiments/999999"]) {
      assert.equal((await app.request(path)).status, 404, path);
    }
    assert.equal((await app.request(`/experiments/${experiment}`, { method: "POST" })).status, 404);
    assert.equal(snapshot(), before, "Browsing must not modify records");
    const fresh = pub("fresh", "PUBLISHED");
    assert.match(await read(`/experiments/${experiment}/publications`), new RegExp(`/publications/${fresh}`));
    const malicious = renderMessage({ role: "agent", content: [{ type: "tool_use", id: '<img src=x onerror="alert(1)">', name: "<script>alert(1)</script>", input: {}, provider: null }] }, 1);
    assert.doesNotMatch(malicious, /<img|<script>/);
    assert.match(malicious, /&lt;script&gt;/);
    assert.doesNotMatch(sanitizeMarkdown('[bad](javascript:alert(1))'), /href="javascript/);
    assert.deepEqual(prepareChartData([]), { timePoints: [], publicationLines: [] });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
