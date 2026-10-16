# Upstream source

These slices come from [dust-tt/srchd](https://github.com/dust-tt/srchd/tree/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08) at `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`, under the [MIT license](../LICENSE), copyright Stanislas Polu.

The flows remain Commander CLI → resources → Drizzle → SQLite, with the upstream runner → model → in-memory MCP tools execution flow added for agent runs.

## Figma proposals (dsgnrd addition)

The optional `figma` server uses the same factory, in-memory MCP pairing, runner dispatch, and conversation storage as other tools. The only runner changes admit the tool name and allow a bounded 180-second request timeout. Publications, review assignment, citations, and solutions retain their existing behavior.

The adapter sends fixed Plugin API scripts with validated JSON inputs through Figma Console MCP 1.40.9 and a running Desktop Bridge. Agents cannot execute arbitrary scripts or choose a destination. `figma_destinations` binds an experiment to an immutable file/page and unique scope; `figma_operations` saves operation intent and results to reconcile uncertain writes. These are additional integration state, not changes to srchd's nine core tables. The full implemented diagram includes them; the srchd reference remains pinned to the version above.

A per-file cross-process lock serializes reads/writes from dsgnrd. A process shares one external MCP connection across its agent servers. The adapter checks exact file/page and canvas ownership markers on every operation. Revisions preserve dimensions, reject unrelated layers, and require the inspected revision. Inspection exports a PNG inside the explicitly file-targeted script, returning immutable evidence through existing messages. Unknown outcomes stay pending and block further experiment writes until reconciliation can prove completion; unresolved partial writes require human investigation. No paid model calls were used in the live integration fixture.

- Unchanged: `src/lib/problem.ts`, `src/lib/utils.ts`, `src/db/index.ts`, `drizzle.config.ts`, and `.nvmrc`.
- `LICENSE`: MIT terms and upstream copyright notice retained for srchd portions; BenCoDev copyright added for dsgnrd contributions.
- `problems/oldskaters/trick-reveal/problem.md`: dsgnrd's own design problem, written with Ben.
- `src/dsgnrd.ts`: upstream error printer, experiment create/list and agent profiles/create/list commands; run and saved-instruction update commands described below; remaining commands omitted; program name and description adapted. Computer profiles are rejected before saving because provisioning is deferred.
- `src/lib/error.ts`: upstream error handling with `SrchdError` renamed to `DsgnrdError`; behavior unchanged.
- `src/resources/experiment.ts`: upstream resource with agent-dependent deletion omitted until agents exist.
- `src/db/schema.ts`: all nine upstream table definitions, plus two dsgnrd-only Figma integration tables described below. The upstream `research` profile default is retained in the schema; the CLI always supplies the required profile explicitly. The core fields and relationships are unchanged.
- `src/migrations/`: generated using Drizzle, with its own migration history. `0001_agents` adds the two tables without modifying existing experiments. Do not point dsgnrd at an srchd database.
- Package dependencies and TypeScript options retain the relevant upstream choices. Anthropic and MCP dependencies are included for agent execution; computer dependencies are deferred; dashboard dependencies are included.

Inherited behavior: duplicate names fail the unique constraint; an empty list exits with a not-found error; creation checks path existence, not problem contents. Relative paths resolve from the working directory. Run commands from the repository root. Folder inputs are accepted without reading `problem.md` at creation time. External paths remain absolute.

Agent slice:

- Unchanged: `src/agent_profile.ts`, `src/lib/fs.ts`, `src/lib/async.ts`, and `src/lib/assert.ts`.
- `src/resources/agent.ts`: upstream resource with deletion deferred; creation saves the first evolution and loading reads its saved instructions.
- `src/models/`: unchanged model types, predicates, provider mapping, and thinking validation, in their upstream files. Anthropic execution and the factory are now included as described below; other provider execution remains deferred.
- `agents/design/`: reusable design instructions and settings in upstream format, with the optional self-editing and web groups enabled.

Inherited agent behavior: names are unique within an experiment; `-c` uses `parseInt` and multiple agents get random suffixes; listing reloads profile settings from disk, while instructions come from the saved evolution. Agent and evolution insertion are separate writes, as upstream. Profiles must remain available on disk. Model names follow the pinned source; creation does not check provider availability.


## Agent-run slice

- `src/runner/index.ts`: upstream initialization, input construction, context pruning, retries, dispatch, persistence, and logging. Research wording is adapted to design. Replay is omitted. Builder rejects unsupported optional tools and returns a clear model-initialization error for unported providers.
- `src/runner/config.ts`, `src/runner/advisory.ts`: copied unchanged. Advisories remain in memory, indexed by agent name, and do not become a durable notification service.
- `src/resources/messages.ts`, `token_usage.ts`, `publication.ts`, and `solutions.ts`: copied unchanged. Review assignment/storage and citation handling remain in `PublicationResource`.
- `src/models/index.ts`, `src/models/anthropic.ts`: copied unchanged, including token accounting, context limits, and pricing assumptions. `provider.ts` retains the factory pattern with only the Anthropic execution branch; unsupported provider execution throws and the builder reports it. Model metadata for the other providers is retained.
- `src/lib/mcp.ts`: upstream in-memory MCP pairing and tool error conversion, with the project error type renamed. The upstream string-edit helpers are used by the optional self-editing server.
- `src/tools/publications.ts`: upstream handlers and collaboration rules, with the conditional computer attachment parameter/transfer/download branches and their imports omitted. Publication headers still expose attachment lists in upstream format. `goal_solution.ts` is unchanged. The tool factory supports the two default groups plus optional self-editing and web, and rejects deferred computer tools.
- `src/dsgnrd.ts`: upstream run command and experiment-wide stopping behavior, excluding computer provisioning. Empty agent selection returns a clear error. A new `agent instructions <name> -e <experiment> -f <file>` setup command calls upstream `AgentResource.evolve()`; it is not an agent-accessible tool. Async command failures use the existing error printer.
- `src/resources/agent.ts`: adds upstream `evolve()`. Evolution queries add descending ID as a timestamp tie-breaker because SQLite timestamps have second precision; an immediate update must remain the latest version after reload.
- `src/migrations/0002_agent_run.sql`: additive migration for messages, token usage, publications, reviews, citations, and solutions. Existing rows and upstream schema relationships are preserved.
- `agents/design/prompt.md`: domain-specific publication/review/solution guidance. No collaboration algorithm changes.

Deferred: non-Anthropic provider execution, computer tools, Kubernetes and image building, attachments, replay/cleanup. Apple and subscription access have separate stories. The pinned source contains self-editing handlers but does not register their tool group in its lists or factory; dsgnrd explicitly enables them as described below.

Inherited limitations: tool effects precede response persistence; writes are not a single transaction; retries can incur multiple API calls; continuous token/cost limits are periodic experiment-wide checks and can overshoot; `--tick` bypasses those checks. Cost calculation uses each agent's current model, so changing models does not preserve historical pricing. Publication timestamps and solution timestamps retain upstream ordering semantics.

## Agent self-editing

`src/tools/system_prompt_self_edit.ts` is copied unchanged from the pinned source. Its `append` and `edit` handlers use the existing `AgentResource.evolve()` to save instructions and update the in-memory agent, so the next tick uses the new version. No schema or orchestration changes are introduced.

Unlike the pinned upstream wiring, dsgnrd registers this group as an optional profile tool and enables it for `design`. Prompt guidance encourages focused changes from reusable lessons, without an automatic trigger. Other agents, the brief and profile files are not edited. Existing agents reload profile tools when started, but retain their saved instructions; to adopt the updated prompt deliberately, use `agent instructions <name> -e <experiment> -f agents/design/prompt.md` before restarting. This setup update is separate from an agent-requested evolution.

The port retains upstream concurrent tool dispatch and full-prompt writes. Multiple self-edit calls in one response can overwrite each other's changes; the prompt asks for one focused self-edit at a time.

## Experiment dashboard

`src/server/` and `src/metrics.ts` port the pinned upstream Hono routes, server-rendered templates, metrics and solution support chart. The `serve` command retains upstream port/basic-auth options and binds to loopback. Attachments are omitted; agent execution and schema are unchanged.

Adaptations: explicit empty states, full saved instructions alongside the initial-version diff, initial/change labels, publication/agent links, withdrawn-choice labels, estimated-cost/activity wording, strict numeric route IDs and uncached responses. Plain strings (including tool names and IDs) are escaped rather than interpreted as HTML. The single-timestamp chart uses a nonzero time range. Publication lookup now checks experiment membership before loading related resources; solution timestamps use IDs to break same-second ties. Evolutions alone do not identify whether a CLI update or an agent tool caused the change.

Validation covers isolated SQLite fixtures, no-network rendering, unchanged records after browsing, collaboration and citations, pending reviews, instruction navigation, withdrawals, refreshed data, scoped URLs and safe generated content. Cost uses the existing current-model estimate; the dashboard does not infer billing totals or process liveness from stored activity.

## Visual web inspection

The pinned `src/tools/web.ts` provides Firecrawl search and Markdown fetch. dsgnrd instead adds `web-open`, `web-act` and `web-close` for visual inspection through Firecrawl 4.46.0's Browser Sandbox API. This is an explicit tool extension, not a verbatim port. Profile selection, in-memory MCP pairing, tool discovery, runner dispatch, image conversion and message persistence retain their existing structure. No schema change.

The model chooses structured clicks (viewport coordinates), scrolls and waits. Handlers generate Playwright code; arbitrary model code is not accepted. Each web instance owns one isolated remote session. Operations are serialized and use observation numbers to reject concurrent/stale actions. Results contain a PNG (at most 2 MB and 1600 pixels per dimension), up to 8192 characters of text, URL, viewport and capture time. The dashboard renders validated PNG data from saved messages rather than expiring URLs or raw base64.

Sessions last at most five minutes, with two creation attempts per agent/run and ten actions per session. Calls have finite timeouts and no automatic SDK retries for side effects. Closing returns available Firecrawl credits and duration as a tool result. Provider error bodies are not persisted because they may include credentials. Firecrawl charges are separate from model estimates and `--max-cost`.

The existing CLI loops now finish in-flight ticks on failure/budget stops and close their servers before exiting. Handled interruption also closes tools; remote TTL bounds sessions after hard termination. `--tick` closes sessions at command completion, so separate commands reload observations, not browsers. There is no browser session table or crash recovery mechanism. Search, authenticated sites, form workflows, video capture and computer provisioning remain deferred.


## Mobbin design references

The optional `mobbin` group is a dsgnrd addition, not a port of upstream tooling. Its local MCP server forwards the three verified search tools to `https://api.mobbin.com/mcp`, preserving the factory, in-memory pairing, runner discovery/dispatch and collaboration rules. Remote schemas are discovered and restricted to these tools; `image_format` is explicitly JPEG for compatibility. Each remote request owns and closes its connection. No database schema changes.

`mobbin login` uses the MCP SDK's OAuth discovery, dynamic registration and PKCE with a loopback callback and state validation. Agent runs do not prompt for login. Credentials are written atomically with private permissions under `~/.config/dsgnrd/mobbin` (override with `DSGNRD_MOBBIN_DIR`); a cross-process lock coordinates refresh and requests for this account. Disconnect removes local credentials; remote revocation remains in Mobbin. After a hard crash, a leftover `lock` directory must be removed only after confirming no Mobbin process is active.

Live contract checks verified screen, flow and section results containing JPEG image blocks, text metadata and structured content. The bridge retains previews and canonical Mobbin links, converts structured content into model-visible text, and omits remote gallery metadata. The dashboard now also renders validated JPEG previews. Images are bounded to 2 MB and 1600 pixels per dimension; aggregate results are bounded to 8 MB. Larger/unsupported responses return an explicit error. These saved previews are conversation evidence, not high-resolution exports. High-resolution URLs expire; exports and Mobbin's gallery are outside this slice.

Authentication, subscription limits and service errors are explicit; no fallback search is invented. Mobbin usage is separate from the runner's model cost estimate. Existing agents reload tools on restart but retain saved instructions; adopt the new profile prompt deliberately with `agent instructions`.
