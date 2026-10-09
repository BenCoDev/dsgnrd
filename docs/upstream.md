# Upstream source

These slices come from [dust-tt/srchd](https://github.com/dust-tt/srchd/tree/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08) at `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`, under the [MIT license](../LICENSE), copyright Stanislas Polu.

The flows remain Commander CLI → problem helper → ExperimentResource and Commander CLI → profile loader → AgentResource → Drizzle → SQLite.

- Unchanged: `src/lib/problem.ts`, `src/lib/utils.ts`, `src/db/index.ts`, `drizzle.config.ts`, and `.nvmrc`.
- `LICENSE`: MIT terms and upstream copyright notice retained for srchd portions; BenCoDev copyright added for dsgnrd contributions.
- `problems/oldskaters/trick-reveal/problem.md`: dsgnrd's own design problem, written with Ben.
- `src/dsgnrd.ts`: upstream error printer, experiment create/list and agent profiles/create/list commands; other commands omitted; program name and description adapted. Computer profiles are rejected before saving because provisioning is deferred.
- `src/lib/error.ts`: upstream error handling with `SrchdError` renamed to `DsgnrdError`; behavior unchanged.
- `src/resources/experiment.ts`: upstream resource with agent-dependent deletion omitted until agents exist.
- `src/db/schema.ts`: unchanged `experiments`, `agents`, and `evolutions` definitions; other tables deferred. The upstream `research` profile default is retained in the schema; the CLI always supplies the required profile explicitly. No fields or relationships redesigned.
- `src/migrations/`: generated using Drizzle, with its own migration history. `0001_agents` adds the two tables without modifying existing experiments. Do not point dsgnrd at an srchd database.
- Package dependencies and TypeScript options retain the relevant upstream choices. No model SDK, runner, server, or computer dependencies are included.

Inherited behavior: duplicate names fail the unique constraint; an empty list exits with a not-found error; creation checks path existence, not problem contents. Relative paths resolve from the working directory. Run commands from the repository root. Folder inputs are accepted without reading `problem.md` at creation time. External paths remain absolute.

Agent slice:

- Unchanged: `src/agent_profile.ts`, `src/lib/fs.ts`, `src/lib/async.ts`, `src/lib/assert.ts`, and `src/tools/constants.ts`. Tool constants describe profile settings; no tools execute yet.
- `src/resources/agent.ts`: upstream resource with deletion and self-editing deferred; creation saves the first evolution and loading reads its saved instructions.
- `src/models/`: unchanged model types, predicates, provider mapping, and thinking validation, in their upstream files. API clients, pricing, execution classes, and `createLLM` are deferred.
- `agents/design/`: reusable design instructions and settings in upstream format, with no optional tools.

Inherited agent behavior: names are unique within an experiment; `-c` uses `parseInt` and multiple agents get random suffixes; listing reloads profile settings from disk, while instructions come from the saved evolution. Agent and evolution insertion are separate writes, as upstream. Profiles must remain available on disk. Model names follow the pinned source; creation does not check provider availability.
