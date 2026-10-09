import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const root = resolve(import.meta.dirname, "..");

test("create/list persist upstream problem references without reading briefs or running agents", () => {
  const workspace = mkdtempSync(join(tmpdir(), "dsgnrd-cli-"));
  const database = join(workspace, "test.sqlite");
  const env = { ...process.env, DATABASE_PATH: database };
  const cli = (...args: string[]) => spawnSync(process.execPath,
    ["--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "src/dsgnrd.ts"), ...args],
    { cwd: workspace, env: { ...env, TSX_TSCONFIG_PATH: join(root, "tsconfig.json") }, encoding: "utf8" });
  try {
    const migrate = spawnSync(process.execPath, [join(root, "node_modules/drizzle-kit/bin.cjs"), "migrate"],
      { cwd: root, env, encoding: "utf8" });
    assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
    mkdirSync(join(workspace, "problems", "design"), { recursive: true });
    const brief = join(workspace, "problems", "design", "brief.md");
    writeFileSync(brief, "UNIQUE_BRIEF_CONTENT_NOT_TO_BE_STORED");
    let result = cli("experiment", "create", "first", "-p", "problems/design/brief.md");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /first/);
    assert.match(result.stdout, /design\/brief.md/);
    result = cli("experiment", "list");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /first/);
    const db = new Database(database);
    try {
      const row = db.prepare("select name, problem, created, updated from experiments").get() as any;
      assert.equal(row.name, "first");
      assert.equal(row.problem, "design/brief.md");
      assert.equal(typeof row.created, "number");
      assert.equal(typeof row.updated, "number");
      // Proves the saved reference remains usable by list even when its file is gone.
      rmSync(brief);
      assert.equal(cli("experiment", "list").status, 0);
      result = cli("experiment", "create", "missing", "-p", "missing.md");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Problem not found/);
      assert.equal((db.prepare("select count(*) as n from experiments").get() as any).n, 1);
      // Upstream accepts a folder before checking its problem.md contents.
      assert.equal(cli("experiment", "create", "folder", "-p", "design").status, 0);
      const external = join(workspace, "external.md");
      writeFileSync(external, "external brief");
      assert.equal(cli("experiment", "create", "external", "-p", external).status, 0);
      assert.equal((db.prepare("select problem from experiments where name = 'external'").get() as any).problem, external);
      assert.notEqual(cli("experiment", "create", "first", "-p", external).status, 0);
      assert.equal((db.prepare("select count(*) as n from experiments").get() as any).n, 3);
      const tables = db.prepare("select name from sqlite_master where type = 'table'").all() as {name: string}[];
      assert.deepEqual(tables.map(t => t.name).filter(n => !n.startsWith("__") && !n.startsWith("sqlite_")).sort(), ["experiments"]);
    } finally { db.close(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
