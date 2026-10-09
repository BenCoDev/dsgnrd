import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const root = resolve(import.meta.dirname, "..");

test("upgrade existing experiments, then create and list agents without credentials or network", () => {
  const workspace = mkdtempSync(join(tmpdir(), "dsgnrd-agents-"));
  const database = join(workspace, "test.sqlite");
  const db = new Database(database);
  // Fail any accidental network access in CLI processes, including SDK requests.
  const offline = join(workspace, "offline.cjs");
  writeFileSync(offline, `const net = require('node:net');
net.Socket.prototype.connect = () => { throw new Error('Unexpected network access'); };
globalThis.fetch = () => { throw new Error('Unexpected network access'); };`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET/.test(key)));
  const cli = (...args: string[]) => spawnSync(process.execPath,
    ["--require", offline, "--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "src/dsgnrd.ts"), ...args],
    { cwd: workspace, env: { ...env, DATABASE_PATH: database, TSX_TSCONFIG_PATH: join(root, "tsconfig.json") }, encoding: "utf8" });
  const success = (...args: string[]) => {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const count = (table: "agents" | "evolutions") => (db.prepare(`select count(*) as n from ${table}`).get() as {n:number}).n;
  try {
    // Build a real database at the previous migration, then upgrade it.
    const previous = join(workspace, "previous");
    mkdirSync(join(previous, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(root, "src/migrations/meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify(journal));
    writeFileSync(join(previous, "0000_experiments.sql"), readFileSync(join(root, "src/migrations/0000_experiments.sql")));
    migrate(drizzle(db), { migrationsFolder: previous });
    db.prepare("insert into experiments (id, created, updated, name, problem) values (1, 10, 10, 'oldskaters', 'oldskaters/trick-reveal')").run();
    migrate(drizzle(db), { migrationsFolder: join(root, "src/migrations") });
    assert.deepEqual(db.prepare("select * from experiments").get(), { id: 1, created: 10, updated: 10, name: "oldskaters", problem: "oldskaters/trick-reveal" });
    db.prepare("insert into experiments (id, created, updated, name, problem) values (2, 10, 10, 'other', 'another.md')").run();
    assert.match(success("agent", "profiles"), /design:/);
    const create = ["agent", "create", "-e", "oldskaters", "-n", "designer", "-p", "design"];
    assert.match(success(...create), /designer/);
    const row = db.prepare("select * from agents").get() as any;
    assert.equal(row.experiment, 1);
    assert.equal(row.profile, "design");
    assert.equal(row.model, "claude-sonnet-5");
    assert.equal(row.provider, "anthropic");
    assert.equal(row.thinking, "low");
    const evolution = db.prepare("select * from evolutions").get() as any;
    assert.equal(evolution.agent, row.id);
    assert.equal(evolution.experiment, 1);
    assert.equal(evolution.system, readFileSync(join(root, "agents/design/prompt.md"), "utf8"));
    assert.match(success("agent", "list", "-e", "oldskaters"), /designer/);
    assert.notEqual(cli("agent", "list", "-e", "other").status, 0);
    for (const options of [[], ["-e", "missing"], ["-p", "missing"], ["-m", "invalid"], ["-t", "invalid"], ["-c", "0"], ["-c", "invalid"]]) {
      const result = cli(...create, ...options);
      assert.notEqual(result.status, 0, JSON.stringify(options));
      assert.equal(count("agents"), 1);
      assert.equal(count("evolutions"), 1);
    }
    success("agent", "create", "-e", "other", "-n", "designer", "-p", "design", "-m", "gpt-5.4", "-t", "high");
    assert.equal((db.prepare("select provider from agents where experiment = 2").get() as any).provider, "openai");
    success("agent", "create", "-e", "other", "-n", "batch", "-p", "design", "-c", "2");
    const names = db.prepare("select name from agents where name like 'batch-%'").all() as {name:string}[];
    assert.equal(names.length, 2);
    assert.ok(names.every(row => /^batch-.{4}$/.test(row.name)));
    assert.doesNotMatch(success("agent", "list", "-e", "oldskaters"), /batch-/);
    success("agent", "create", "-e", "other", "-p", "design");
    assert.equal(count("agents"), 5);
    assert.equal(count("evolutions"), 5);
    assert.deepEqual(db.prepare("pragma foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
