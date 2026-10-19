# Web finishing

Use HTML/CSS as an alternative execution medium for an existing proposition. Research, agents, publications, reviews and the Runner keep their existing roles. This adds an optional tool and two ordinary profiles, not another orchestration step or database entity.

## Setup

Use the repository's supported Node/npm versions, then:

```sh
npm ci
npx playwright install chromium
```

For project-local browser binaries instead of the default Playwright cache:

```sh
PLAYWRIGHT_BROWSERS_PATH=.local/playwright npx playwright install chromium
export PLAYWRIGHT_BROWSERS_PATH=.local/playwright
```

Pass that environment to the agent runner as well as tests. On Linux, Chromium may require system libraries; see [Playwright browser installation](https://playwright.dev/docs/browsers). Launch failures are reported, not replaced with fake screenshots. The browser is local: no model or Firecrawl charges are incurred by prototype rendering itself. Model calls still use the normal provider billing.

Restart an already-running dsgnrd server after upgrading to load the new preview route.

## Profiles and assignment

- `design-web-finisher`: `prototype`, `mobbin`, `web`; develops the selected proposition, inspects inherited references, implements and tests the flow, then revises from critique.
- `design-web-reviewer`: `prototype` in read-only source mode; retrieves research with the default publication tools, inspects the cited revision and exercises the flow. Source writes are absent from its tool list, not merely discouraged by its prompt.

Use the existing agent creation/run commands or existing bounded-run harness. Give the finisher the source publication reference, scope, constraints, target viewport, designated reviewer and stopping condition. A reviewer is an ordinary agent; standard reviewer selection is unchanged. For a controlled comparison, reuse the same research proposition and references, and retain the same independent polish cap.

Suggested assignment: build the main adjustment screen first, then connect constraint selection → proposed change → confirm/decline → undo. One initial publication, substantive critique, one revised publication and final review. Evaluate visual craft, product clarity and interaction quality separately. The profiles also require keyboard, narrow-screen and reduced-motion checks.

**The ordinary experiment run command still does not enforce dollar budgets.** Use the existing shared-budget harness for a paid comparison. This implementation does not start or authorize a new paid run.

## Tools

| Tool | Purpose |
|---|---|
| `prototype-save` | Save `{title, html, css, javascript}`. HTML is body markup; plain JavaScript executes in the browser. Returns author, full revision and previewPath. |
| `prototype-edit` | Replace exactly one `oldText` with `newText` in one source file of your own revision. Returns another revision; never mutates the old one. |
| `prototype-list` | List your or a specified peer's saved revisions in this experiment. |
| `prototype-read` | Read a source excerpt; follow `nextOffset` until null. Peer reads are supported. |
| `prototype-inspect` | Render exact author/revision at a viewport (default 390×844), optionally reduced motion. Resets state and returns PNG, visible text, controls, runtime errors and horizontal-overflow hint. |
| `prototype-act` | Click a CSS selector, fill an input, press a bounded keyboard key, scroll or wait. Requires the latest session/observation; returns another screenshot. |
| `prototype-close` | Close the browser; saved files and UI previews remain. |

Each inspection has a fresh isolated browser session, with at most 40 actions and a ten-minute expiry. Only one inspection is active per tool server. Concurrent calls are serialized. Stale observations are rejected; a failed interaction closes the session because the action may have partially executed. Reinspect to reset instead of blindly replaying it. Closing the tool server closes Chromium.

## Files, previews and evidence

Saved artifacts live at `.local/prototypes/<database-namespace>/<experiment>/<author>/<sha256>.json`. `DSGNRD_PROTOTYPES_DIR` overrides the root; use a real directory path without symlinks. The database namespace is derived from the absolute `DATABASE_PATH`, preventing different local databases with overlapping IDs from sharing artifacts. Keep the same database path and artifact root between runner and UI. Moving a database requires preserving/migrating its artifact namespace separately.

The JSON contains the title and HTML/CSS/JavaScript source. Its full SHA-256 is the revision. Saves are idempotent, content is checked on read, and symlink files/directories are rejected. Maximum serialized artifact size is 512KB; an author may save up to 100 unique revisions per experiment. There is no mutable “latest” pointer, lock table, new publication type or schema migration. Back up these files alongside the database if you want previews to survive moving the experiment.

The returned link is `/experiments/<id>/prototypes/<author>/<revision>`. Include it directly as a Markdown link in the publication, along with exact revision, tested states, viewport and limitations. It opens a live, sandboxed prototype in the existing server UI and inherits the server's authentication. It remains available after the agent/browser exits.

Prototype source runs only inside an opaque-origin sandboxed iframe. Content policy blocks remote assets, fetches, workers, child frames and forms; the automated browser additionally blocks outbound requests and WebSockets. No shell execution, server-side JavaScript, user browser profile or authenticated service access is exposed. Use system fonts, inline SVG or data URLs; there is no bundler or npm-install tool. This intentionally keeps the first comparison self-contained. It does not provide a backend or real data persistence.

Publications show up to three saved screenshot previews for cited revisions/viewports, using observations available at publication time. Opening the link resets state; a saved screenshot may show a later interaction state. Screenshots also remain in normal agent conversations and publication-context retrieval. Finish inspections in a turn before publishing so their evidence is recorded in the handoff. Overview propositions remain propositions; there is no separate prototype entity in the overview.

## Local verification (no paid models)

```sh
npm run typecheck
npm test
PLAYWRIGHT_BROWSERS_PATH=.local/playwright \
  DSGNRD_TEST_PROTOTYPE_BROWSER=1 \
  DSGNRD_TEST_EVIDENCE_DIR=.local/prototype-verification \
  node --import tsx --test tests/prototype.test.ts
```

The normal suite tests version integrity, targeted editing, experiment/author boundaries, reviewer write restrictions, authenticated/sandboxed preview responses and publication evidence timing. The opt-in real Chromium test checks typing, apply/undo, keyboard focus, narrow rendering, reduced motion, blocked requests, stale/concurrent actions and isolated peer inspection. It uses a temporary database and makes no provider calls. It can save a screenshot to the evidence directory.

The test fixture is deliberately simple; passing these checks proves tool operation, not better design. Paid comparisons should evaluate the resulting prototype against the existing Figma design at the same viewport and budget. Figma export, external dependencies, asset ingestion and production deployment are outside this first implementation.


## First live comparison

The first web finishing run used an existing research proposition, one finisher and one reviewer, with a shared $10 cap enforced by a local harness. It published an interactive prototype at **$9.3568175 tracked model upper cost**. No web-tool calls were made. The reviewer inspected part of the flow but did not submit a graded review; no review-driven revision was completed.

Independent local Chromium checks at 390×844 and 320×844 exercised selection, adjustment, confirmation and undo without console errors or horizontal overflow. They also exposed product defects: no-equipment selection still suggested dumbbells, a 30-minute selection became 20 minutes on confirmation, and the confirmation toast overlapped the main action. Full-session and workout-player controls remained stubs.

This demonstrates working tools and an inspectable deliverable, not a polished or accepted design. The agent spent too many calls on small interaction checks and left insufficient capacity for critique and revision. Future assignments should constrain the scenario, batch verification, and reserve review/revision capacity. The run inherited earlier research and critique, so it is not a controlled comparison of HTML/CSS versus Figma. Private briefs, generated artifacts and spending ledgers remain in ignored local storage.
