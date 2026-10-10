# Agent-run verification

Verified on 2026-10-10 against srchd reference `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`.

## Automated checks

- Clean `npm ci` using Node 24.16.0 and npm 12.0.2: passed. npm reported no vulnerabilities; optional fsevents install scripts remained blocked by the existing allowlist.
- `npm run typecheck`: passed.
- `npm test`: four test cases passed, covering the scenarios below.
- `git diff --check`: passed.
- Regenerated the three dsgnrd SVG exports with Mermaid CLI 12.0.0. Visually inspected the complete schema preview. The srchd reference diagrams were not changed.

The tests cover migration from a populated previous schema; experiment/agent creation without API access; Anthropic request/response conversion and authentication failures through an intercepted SDK request; real in-memory MCP tool execution with a deterministic model; ordered messages and linked usage; continuation in separate processes; missing usage and empty responses; unknown tools and unsupported providers; continuous stopping based on accumulated token/cost totals; and instruction evolution, including same-second ordering.

Collaboration checks cover pending-review blocking, insufficient reviewers, author exclusion, assigned-review validation, waiting for every reviewer, acceptance and rejection, direct publication with zero reviewers, citations, reporting a published solution, refusing an unpublished solution, and withdrawing a solution with a null reference.

## Bounded live verification

Used a separate local database and Haiku agents created specifically for the demonstration. Each command ran with `--tick` in a new process; there was no unattended continuous API run. The original saved designer's model selection was retained. Its instructions were updated through a new evolution, and the normal dsgnrd database was migrated without removing existing records.

The demonstration instructions asked the author to submit a concise proposal and the reviewer to read and honestly review assigned work. They did not force an acceptance grade.

| Scenario | Observed result |
| --- | --- |
| Author, one required reviewer | Submitted `tg5l`, “Portrait Viewport Reveals: Phone-Framed Trick Videos with Dynamic Composition”; review assigned to the other agent |
| Reviewer, first invocation | Retrieved the full proposal using `publications-get_publication` |
| Reviewer, second invocation | Resumed saved tool results and submitted `ACCEPT`; `tg5l` became `PUBLISHED` |
| Author continuation | Queried publications, then explicitly acknowledged the published proposal and its ACCEPT grade |
| Solo agent, zero reviewers | Submitted `u86c`; it published directly and its publication advisory was saved alongside the tool result |
| Solo continuation | A new process consumed the previous exchange and called `publications-list_review_requests` |

Eight successful model calls recorded 24,585 input tokens and 6,839 output tokens (31,424 total). The database contains 19 messages across the three demonstration agents, two published proposals, and two additional submitted proposals with pending reviews.

**Limits of the live evidence:** the author continued proposing ideas rather than calling `goal_solution-report`, even after a focused instruction update. No live solution selection is claimed: that table is empty in the demonstration database. Solution reporting, rejection, citations, and withdrawal were verified deterministically through the actual tool handlers. The two additional proposals remain pending because the bounded demonstration stopped.

## Inspect the local demonstration

The database and logs from this session remain at `/tmp/dsgnrd-live-X278BX/`; they are not committed and may be removed by the operating system. Use `live.sqlite` there instead of `db.sqlite` in the README queries. The implementation needs no fixture data or local log files to operate.

```sh
sqlite3 -header -column /tmp/dsgnrd-live-X278BX/live.sqlite \
  'SELECT reference, title, status FROM publications;'
sqlite3 /tmp/dsgnrd-live-X278BX/live.sqlite \
  "SELECT content FROM publications WHERE reference = 'tg5l';"
sqlite3 -header -column /tmp/dsgnrd-live-X278BX/live.sqlite \
  'SELECT publication, author, grade, content FROM reviews;'
```

For reproducible schema exports, regenerate the overview with `node scripts/render-schema.mjs`, then use `npx --package=@mermaid-js/mermaid-cli@12.0.0 mmdc -i <source.mmd> -o <output.svg> -b transparent` for each dsgnrd view. Keep the generator's snapshot reference aligned with future schema migrations.
