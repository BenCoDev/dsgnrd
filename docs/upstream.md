# Upstream source

These slices come from [dust-tt/srchd](https://github.com/dust-tt/srchd/tree/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08) at `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`, under the [MIT license](../LICENSE), copyright Stanislas Polu.

The flows remain Commander CLI → resources → Drizzle → SQLite, with the upstream runner → model → in-memory MCP tools execution flow added for agent runs.

- Unchanged: `src/lib/problem.ts`, `src/lib/utils.ts`, `src/db/index.ts`, `drizzle.config.ts`, and `.nvmrc`.
- `LICENSE`: MIT terms and upstream copyright notice retained for srchd portions; BenCoDev copyright added for dsgnrd contributions.
- `problems/oldskaters/trick-reveal/problem.md`: dsgnrd's own design problem, written with Ben.
- `src/dsgnrd.ts`: upstream error printer, experiment create/list and agent profiles/create/list commands; run and saved-instruction update commands described below; remaining commands omitted; program name and description adapted. Computer profiles are rejected before saving because provisioning is deferred.
- `src/lib/error.ts`: upstream error handling with `SrchdError` renamed to `DsgnrdError`; behavior unchanged.
- `src/resources/experiment.ts`: upstream resource with agent-dependent deletion omitted until agents exist.
- `src/db/schema.ts`: all nine upstream table definitions. The upstream `research` profile default is retained in the schema; the CLI always supplies the required profile explicitly. No fields or relationships redesigned.
- `src/migrations/`: generated using Drizzle, with its own migration history. `0001_agents` adds the two tables without modifying existing experiments. Do not point dsgnrd at an srchd database.
- Package dependencies and TypeScript options retain the relevant upstream choices. Anthropic and MCP dependencies are included for agent execution; computer and web-server dependencies are deferred.

Inherited behavior: duplicate names fail the unique constraint; an empty list exits with a not-found error; creation checks path existence, not problem contents. Relative paths resolve from the working directory. Run commands from the repository root. Folder inputs are accepted without reading `problem.md` at creation time. External paths remain absolute.

Agent slice:

- Unchanged: `src/agent_profile.ts`, `src/lib/fs.ts`, `src/lib/async.ts`, `src/lib/assert.ts`, and `src/tools/constants.ts`. Tool constants describe profile settings; no tools execute yet.
- `src/resources/agent.ts`: upstream resource with deletion deferred; creation saves the first evolution and loading reads its saved instructions.
- `src/models/`: unchanged model types, predicates, provider mapping, and thinking validation, in their upstream files. Anthropic execution and the factory are now included as described below; other provider execution remains deferred.
- `agents/design/`: reusable design instructions and settings in upstream format, with no optional tools.

Inherited agent behavior: names are unique within an experiment; `-c` uses `parseInt` and multiple agents get random suffixes; listing reloads profile settings from disk, while instructions come from the saved evolution. Agent and evolution insertion are separate writes, as upstream. Profiles must remain available on disk. Model names follow the pinned source; creation does not check provider availability.


## Agent-run slice

- `src/runner/index.ts`: upstream initialization, input construction, context pruning, retries, dispatch, persistence, and logging. Research wording is adapted to design. Replay is omitted. Builder rejects unsupported optional tools and returns a clear model-initialization error for unported providers.
- `src/runner/config.ts`, `src/runner/advisory.ts`: copied unchanged. Advisories remain in memory, indexed by agent name, and do not become a durable notification service.
- `src/resources/messages.ts`, `token_usage.ts`, `publication.ts`, and `solutions.ts`: copied unchanged. Review assignment/storage and citation handling remain in `PublicationResource`.
- `src/models/index.ts`, `src/models/anthropic.ts`: copied unchanged, including token accounting, context limits, and pricing assumptions. `provider.ts` retains the factory pattern with only the Anthropic execution branch; unsupported provider execution throws and the builder reports it. Model metadata for the other providers is retained.
- `src/lib/mcp.ts`: upstream in-memory MCP pairing and tool error conversion, with the project error type renamed. Existing string-edit helpers are retained but no self-editing server is registered.
- `src/tools/publications.ts`: upstream handlers and collaboration rules, with the conditional computer attachment parameter/transfer/download branches and their imports omitted. Publication headers still expose attachment lists in upstream format. `goal_solution.ts` is unchanged. The tool factory supports the two default groups and rejects deferred optional tools.
- `src/dsgnrd.ts`: upstream run command and experiment-wide stopping behavior, excluding computer provisioning. Empty agent selection returns a clear error. A new `agent instructions <name> -e <experiment> -f <file>` setup command calls upstream `AgentResource.evolve()`; it is not an agent-accessible tool. Async command failures use the existing error printer.
- `src/resources/agent.ts`: adds upstream `evolve()`. Evolution queries add descending ID as a timestamp tie-breaker because SQLite timestamps have second precision; an immediate update must remain the latest version after reload.
- `src/migrations/0002_agent_run.sql`: additive migration for messages, token usage, publications, reviews, citations, and solutions. Existing rows and upstream schema relationships are preserved.
- `agents/design/prompt.md`: domain-specific publication/review/solution guidance. No collaboration algorithm changes.

Deferred: non-Anthropic provider execution, optional web/computer tools, Kubernetes and image building, attachments, UI/server, replay/cleanup, and autonomous prompt editing. Apple and subscription access have separate stories. The pinned source contains self-editing handlers but does not register their tool group in its lists or factory.

Inherited limitations: tool effects precede response persistence; writes are not a single transaction; retries can incur multiple API calls; continuous token/cost limits are periodic experiment-wide checks and can overshoot; `--tick` bypasses those checks. Cost calculation uses each agent's current model, so changing models does not preserve historical pricing. Publication timestamps and solution timestamps retain upstream ordering semantics.
