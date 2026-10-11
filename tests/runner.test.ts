import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const root = resolve(import.meta.dirname, "..");
const text = (value: string) => ({ type: "text", text: value, provider: null });
const tool = (name: string, input: object) => ({
  type: "tool_use",
  id: crypto.randomUUID(),
  name,
  input,
  provider: null,
});

test("migration, cross-process ticks, peer review, citations, solution reports and instruction evolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "dsgnrd-runner-"));
  const db = new Database(join(dir, "test.sqlite"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/API_KEY|TOKEN|SECRET/.test(k),
    ),
  );
  Object.assign(env, {
    DATABASE_PATH: join(dir, "test.sqlite"),
    TSX_TSCONFIG_PATH: join(root, "tsconfig.json"),
  });
  const offline = join(dir, "offline.cjs");
  writeFileSync(
    offline,
    "globalThis.fetch = () => { throw new Error('Unexpected network access'); };",
  );
  const exec = (
    file: string,
    args: string[] = [],
    extra: Record<string, string> = {},
  ) =>
    spawnSync(
      process.execPath,
      [
        "--require",
        offline,
        "--import",
        join(root, "node_modules/tsx/dist/loader.mjs"),
        join(root, file),
        ...args,
      ],
      { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
    );
  const cli = (...args: string[]) => {
    const r = exec("src/dsgnrd.ts", args);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  };
  const one = (sql: string, ...args: any[]) =>
    db.prepare(sql).get(...args) as any;
  const all = (sql: string, ...args: any[]) =>
    db.prepare(sql).all(...args) as any[];
  const tick = (
    agent: string,
    content: object[],
    reviewers = 1,
    noUsage = false,
  ) => {
    const r = exec("tests/fixtures/run-tick.ts", [], {
      AGENT: agent,
      RESPONSE: JSON.stringify({ role: "agent", content }),
      REVIEWERS: String(reviewers),
      CAPTURE: join(dir, "capture.json"),
      ...(noUsage ? { NO_USAGE: "1" } : {}),
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  };
  const lastResult = (agent = "author") => {
    const row = one(
      "select content from messages where agent=(select id from agents where name=?) order by position desc limit 1",
      agent,
    );
    return JSON.parse(row.content)[0];
  };
  const submit = (title: string, content = title) =>
    tool("publications-submit_publication", {
      title,
      abstract: title,
      content,
    });
  try {
    // Upgrade a populated database from the previous story, not an empty schema.
    const old = join(dir, "old");
    mkdirSync(join(old, "meta"), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(root, "src/migrations/meta/_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(join(old, "meta/_journal.json"), JSON.stringify(journal));
    for (const f of ["0000_experiments.sql", "0001_agents.sql"])
      writeFileSync(
        join(old, f),
        readFileSync(join(root, "src/migrations", f)),
      );
    migrate(drizzle(db), { migrationsFolder: old });
    cli(
      "experiment",
      "create",
      "test",
      "-p",
      "problems/oldskaters/trick-reveal",
    );
    cli(
      "agent",
      "create",
      "-e",
      "test",
      "-n",
      "author",
      "-p",
      "design",
      "-m",
      "claude-haiku-4-5",
    );
    const before = {
      agent: one("select * from agents"),
      evolution: one("select * from evolutions"),
    };
    migrate(drizzle(db), { migrationsFolder: join(root, "src/migrations") });
    assert.deepEqual(one("select * from agents"), before.agent);
    assert.deepEqual(one("select * from evolutions"), before.evolution);
    cli(
      "agent",
      "create",
      "-e",
      "test",
      "-n",
      "reviewer",
      "-p",
      "design",
      "-m",
      "claude-haiku-4-5",
    );

    const input = tick("author", [submit("First proposal")]);
    assert.match(input.prompt, /Oldskaters/i);
    assert.match(input.prompt, /design collaborator/);
    assert.equal(input.messages.length, 1);
    assert.deepEqual(
      input.tools.map((t: any) => t.name).sort(),
      [
        "goal_solution-report",
        "publications-list_publications",
        "publications-get_publication",
        "publications-submit_publication",
        "publications-list_review_requests",
        "publications-list_submitted_publications",
        "publications-submit_review",
      ].sort(),
    );
    assert.equal(lastResult().isError, false);
    assert.deepEqual(
      all("select position,role from messages").map((r) => [
        r.position,
        r.role,
      ]),
      [
        [0, "user"],
        [1, "agent"],
        [2, "user"],
      ],
    );
    const pub = one("select * from publications");
    const review = one("select * from reviews");
    assert.equal(pub.status, "SUBMITTED");
    assert.notEqual(review.author, pub.author);
    const usage = one("select * from token_usages");
    assert.equal(usage.agent, pub.author);
    assert.equal(usage.experiment, pub.experiment);
    assert.equal(
      one("select role from messages where id=?", usage.message).role,
      "agent",
    );
    assert.throws(
      () =>
        db
          .prepare(
            "insert into messages(created,updated,experiment,agent,position,role,content) select created,updated,experiment,agent,position,role,content from messages limit 1",
          )
          .run(),
      /UNIQUE/,
    );

    // New process sees the previous tool results, without adding another starting message.
    const resumed = tick("author", [text("Waiting for review.")]);
    assert.equal(resumed.messages.length, 3);
    assert.equal(resumed.messages[2].content[0].type, "tool_result");
    tick("author", [
      tool("goal_solution-report", {
        publication: pub.reference,
        reason: "no_previous",
        rationale: "candidate",
      }),
    ]);
    assert.equal(lastResult().isError, true);
    assert.equal(one("select count(*) n from solutions").n, 0);
    tick("author", [
      tool("publications-submit_review", {
        publication: pub.reference,
        grade: "ACCEPT",
        content: "Self review",
      }),
    ]);
    assert.equal(lastResult().isError, true);
    const reviewerInput = tick("reviewer", [submit("Blocked")]);
    assert.match(JSON.stringify(reviewerInput.messages), /PENDING_REVIEWS/);
    assert.ok(JSON.stringify(reviewerInput.messages).includes(pub.reference));
    assert.equal(lastResult("reviewer").isError, true);
    assert.equal(one("select count(*) n from publications").n, 1);
    tick("reviewer", [
      tool("publications-submit_review", {
        publication: pub.reference,
        grade: "ACCEPT",
        content: "Meets the brief.",
      }),
    ]);
    assert.equal(
      one("select status from publications where id=?", pub.id).status,
      "PUBLISHED",
    );
    assert.equal(
      one("select grade from reviews where id=?", review.id).grade,
      "ACCEPT",
    );
    tick("author", [text("Checking the outcome next.")]);
    const outcome = tick("author", [
      tool("goal_solution-report", {
        publication: pub.reference,
        reason: "no_previous",
        rationale: "Meets the brief",
      }),
    ]);
    assert.ok(JSON.stringify(outcome.messages).includes("PUBLISHED"));
    assert.equal(one("select publication from solutions").publication, pub.id);
    tick("author", [submit("Follow-up", `Builds on [${pub.reference}].`)], 0);
    const second = one("select * from publications where title=?", "Follow-up");
    assert.equal(second.status, "PUBLISHED");
    assert.deepEqual(all('select "from","to" from citations'), [
      { from: second.id, to: pub.id },
    ]);
    tick("author", [
      tool("goal_solution-report", {
        publication: null,
        reason: "previous_wrong",
        rationale: "Reconsidering",
      }),
    ]);
    assert.equal(
      one("select publication from solutions order by id desc").publication,
      null,
    );
    tick("author", [submit("Rejected proposal")]);
    const rejected = one(
      "select * from publications where title=?",
      "Rejected proposal",
    );
    tick("reviewer", [
      tool("publications-submit_review", {
        publication: rejected.reference,
        grade: "REJECT",
        content: "Misses a constraint.",
      }),
    ]);
    assert.equal(
      one("select status from publications where id=?", rejected.id).status,
      "REJECTED",
    );
    tick("author", [submit("Too few reviewers")], 4);
    assert.equal(lastResult().isError, true);

    // All reviews must arrive before rejection/publication, even if the first rejects.
    cli(
      "agent",
      "create",
      "-e",
      "test",
      "-n",
      "third",
      "-p",
      "design",
      "-m",
      "claude-haiku-4-5",
    );
    tick("author", [submit("Two reviews")], 2);
    const two = one("select * from publications where title=?", "Two reviews");
    tick("reviewer", [
      tool("publications-submit_review", {
        publication: two.reference,
        grade: "STRONG_REJECT",
        content: "Problem",
      }),
    ]);
    assert.equal(
      one("select status from publications where id=?", two.id).status,
      "SUBMITTED",
    );
    tick("third", [
      tool("publications-submit_review", {
        publication: two.reference,
        grade: "ACCEPT",
        content: "Accept",
      }),
    ]);
    assert.equal(
      one("select status from publications where id=?", two.id).status,
      "REJECTED",
    );

    const historyCount = one("select count(*) n from messages").n;
    const instructions = join(dir, "instructions.md");
    writeFileSync(instructions, "UPDATED DESIGN INSTRUCTIONS");
    cli("agent", "instructions", "author", "-e", "test", "-f", instructions);
    assert.equal(
      one("select count(*) n from evolutions where agent=?", pub.author).n,
      2,
    );
    assert.equal(one("select count(*) n from messages").n, historyCount);
    const usageBeforeMissing = one("select count(*) n from token_usages").n;
    const changed = tick("author", [text("Updated")], 0, true);
    assert.match(changed.prompt, /UPDATED DESIGN INSTRUCTIONS/);
    assert.equal(
      one("select count(*) n from token_usages").n,
      usageBeforeMissing,
    );
    const usages = one("select count(*) n from token_usages").n;
    const messages = one("select count(*) n from messages").n;
    tick("author", [], 0);
    assert.equal(one("select count(*) n from token_usages").n, usages);
    assert.equal(one("select count(*) n from messages").n, messages + 1); // automated input only
    tick("author", [tool("missing-tool", {})], 0);
    assert.equal(lastResult().isError, true);
    assert.deepEqual(all("pragma foreign_key_check"), []);

    for (const args of [
      ["agent", "run", "missing", "-e", "test", "--tick"],
      ["agent", "run", "author", "-e", "missing", "--tick"],
      ["agent", "run", "author", "-e", "test", "--tick"], // missing credentials/token count error
    ])
      assert.notEqual(exec("src/dsgnrd.ts", args).status, 0);
    // Continuous mode checks accumulated experiment usage before the first tick.
    db.prepare(
      "update token_usages set total=2000000 where id=(select min(id) from token_usages)",
    ).run();
    const stopped = exec("src/dsgnrd.ts", [
      "agent",
      "run",
      "author",
      "-e",
      "test",
      "--max-tokens",
      "1",
    ]);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    assert.match(stopped.stdout, /Tokens exceeded/);
    const costStopped = exec("src/dsgnrd.ts", [
      "agent",
      "run",
      "author",
      "-e",
      "test",
      "--max-cost",
      "0.00000001",
    ]);
    assert.equal(
      costStopped.status,
      0,
      costStopped.stdout + costStopped.stderr,
    );
    assert.match(costStopped.stdout, /Cost exceeded/);
    // Same-second evolution reload chooses the most recently inserted ID.
    db.prepare("update evolutions set created=100 where agent=?").run(
      pub.author,
    );
    const tied = tick("author", [text("Latest version")], 0);
    assert.match(tied.prompt, /UPDATED DESIGN INSTRUCTIONS/);
    cli(
      "agent",
      "create",
      "-e",
      "test",
      "-n",
      "unsupported",
      "-p",
      "design",
      "-m",
      "gpt-5.4",
    );
    const unsupported = exec("src/dsgnrd.ts", [
      "agent",
      "run",
      "unsupported",
      "-e",
      "test",
      "--tick",
    ]);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /not implemented/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
