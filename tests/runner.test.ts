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
    DSGNRD_MOBBIN_DIR: join(dir, "mobbin"),
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
        "system_prompt_self_edit-append",
        "system_prompt_self_edit-edit",
        "web-open", "web-act", "web-close",
        "mobbin-search_screens", "mobbin-search_flows", "mobbin-search_sections",
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

    // Real MCP self-edits update the same in-memory agent before the next tick.
    const versionsBefore = all("select * from evolutions order by id");
    const messagesBefore = all("select * from messages order by id");
    const profileBefore = readFileSync(join(root, "agents/design/prompt.md"), "utf8");
    const briefBefore = readFileSync(join(root, "problems/oldskaters/trick-reveal/problem.md"), "utf8");
    const sequence = [
      [tool("system_prompt_self_edit-append", { new_str: "\nCheck footage constraints." })],
      [tool("system_prompt_self_edit-edit", {
        old_str: "Check footage constraints.",
        new_str: "Check source footage before proposing crops.",
      })],
      [tool("system_prompt_self_edit-edit", {
        old_str: "Text that is not in these instructions",
        new_str: "Should not be saved",
      })],
      [tool("system_prompt_self_edit-edit", {
        old_str: "Check source footage before proposing crops.",
        new_str: "Should not be saved",
        expected_replacements: 2,
      })],
      [text("Continue using the revised approach.")],
    ].map(content => ({ role: "agent", content }));
    const edited = exec("tests/fixtures/run-tick.ts", [], {
      AGENT: "author",
      RESPONSES: JSON.stringify(sequence),
      CAPTURE: join(dir, "self-edit.json"),
    });
    assert.equal(edited.status, 0, edited.stdout + edited.stderr);
    const capture = (suffix: string) => JSON.parse(readFileSync(join(dir, `self-edit.json${suffix}`), "utf8"));
    assert.doesNotMatch(capture("").prompt, /Check footage constraints/);
    assert.match(capture(".1").prompt, /Check footage constraints\./);
    const expected = "UPDATED DESIGN INSTRUCTIONS\nCheck source footage before proposing crops.";
    for (const suffix of [".2", ".3", ".4"]) {
      assert.ok(capture(suffix).prompt.endsWith(expected));
    }
    const versionsAfter = all("select * from evolutions order by id");
    assert.deepEqual(versionsAfter.slice(0, versionsBefore.length), versionsBefore);
    const added = versionsAfter.slice(versionsBefore.length);
    assert.equal(added.length, 2);
    assert.ok(added.every(v => v.agent === pub.author && v.experiment === pub.experiment));
    assert.equal(added[0].system, "UPDATED DESIGN INSTRUCTIONS\nCheck footage constraints.");
    assert.equal(added[1].system, expected);
    assert.deepEqual(all("select * from messages order by id").slice(0, messagesBefore.length), messagesBefore);
    const exchanges = all("select content from messages where id > ? and role='user' order by id", messagesBefore.at(-1).id)
      .flatMap(m => JSON.parse(m.content)).filter(c => c.type === "tool_result");
    assert.deepEqual(exchanges.map(c => c.isError), [false, false, true, true]);
    assert.equal(readFileSync(join(root, "agents/design/prompt.md"), "utf8"), profileBefore);
    assert.equal(readFileSync(join(root, "problems/oldskaters/trick-reveal/problem.md"), "utf8"), briefBefore);
    assert.ok(tick("author", [text("Resumed with evolved instructions.")], 0).prompt.endsWith(expected));

    // The group is optional: a profile with no extras cannot invoke it.
    const unavailable = exec("tests/fixtures/run-tick.ts", [], {
      AGENT: "reviewer",
      NO_OPTIONAL_TOOLS: "1",
      RESPONSE: JSON.stringify({ role: "agent", content: [tool("system_prompt_self_edit-append", {new_str: "Not allowed"})] }),
      CAPTURE: join(dir, "no-self-edit.json"),
    });
    assert.equal(unavailable.status, 0, unavailable.stdout + unavailable.stderr);
    const noTools = JSON.parse(readFileSync(join(dir, "no-self-edit.json"), "utf8"));
    assert.ok(noTools.tools.every((t: any) => !t.name.startsWith("system_prompt_self_edit-")));
    assert.equal(lastResult("reviewer").isError, true);
    assert.equal(one("select count(*) n from evolutions").n, versionsAfter.length);
    assert.ok(noTools.tools.every((t: any) => !t.name.startsWith("web-")));
    assert.ok(noTools.tools.every((t: any) => !t.name.startsWith("mobbin-")));
    for (const mode of ["tick", "failure", "signal", "budget"]) {
      const log = join(dir, `close-${mode}.log`);
      const result = exec("tests/fixtures/run-browser-cli.ts", ["agent", "run", "author", "-e", "test", "--reviewers", "0", ...(mode === "tick" ? ["--tick"] : mode === "budget" ? ["--max-cost", "1"] : [])], {
        ANTHROPIC_API_KEY:"test-only", FIRECRAWL_API_KEY:"test-only", CLOSE_LOG:log, STOP_MODE:mode,
      });
      assert.equal(result.status, mode === "tick" || mode === "budget" ? 0 : mode === "signal" ? 130 : 1, result.stdout+result.stderr);
      assert.equal(readFileSync(log,"utf8"),"closed\n");
    }
    const web = exec("tests/fixtures/run-tick.ts", [], {
      AGENT: "author", WEB_FIXTURE: "1",
      RESPONSE: JSON.stringify({role:"agent",content:[tool("web-open",{url:"https://example.com"})]}),
      CAPTURE: join(dir,"web.json"),
    });
    assert.equal(web.status,0,web.stdout+web.stderr);
    const savedImage=lastResult().content.find((c: any)=>c.type==="image");
    assert.equal(savedImage.mimeType,"image/png");
    const resumedWeb = tick("author",[text("Reviewing the screenshot from the previous command.")],0);
    assert.ok(resumedWeb.messages.some((m: any)=>m.content.some((c: any)=>c.type==="tool_result" && c.content.some((v: any)=>v.type==="image" && v.data===savedImage.data))));

    tick("author", [tool("mobbin-search_screens", {query:"video discovery",platform:"ios",limit:1})],0);
    const reference = lastResult();
    assert.equal(reference.isError,false);
    assert.ok(reference.content.some((c:any)=>c.type==="image"));
    const resumedMobbin=tick("author",[text("Inspecting the saved Mobbin reference.")],0);
    assert.ok(resumedMobbin.messages.some((m:any)=>m.content.some((c:any)=>c.type==="tool_result" && c.toolUseName==="mobbin-search_screens" && c.content.some((v:any)=>v.type==="image"))));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
