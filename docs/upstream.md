# Upstream source

This first slice comes from [dust-tt/srchd](https://github.com/dust-tt/srchd/tree/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08) at `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`, under the [MIT license](../LICENSE), copyright Stanislas Polu.

The flow remains Commander CLI → problem helper → ExperimentResource → Drizzle → SQLite.

- Unchanged: `src/lib/problem.ts`, `src/lib/utils.ts`, `src/db/index.ts`, `drizzle.config.ts`, and `.nvmrc`.
- `LICENSE`: MIT terms and upstream copyright notice retained for srchd portions; BenCoDev copyright added for dsgnrd contributions.
- `problems/design/oldskaters-trick-reveal/problem.md`: dsgnrd's own design problem, written with Ben.
- `src/dsgnrd.ts`: upstream error printer and experiment create/list commands; other commands omitted; program name and description adapted.
- `src/lib/error.ts`: upstream error handling with `SrchdError` renamed to `DsgnrdError`; behavior unchanged.
- `src/resources/experiment.ts`: upstream resource with agent-dependent deletion omitted until agents exist.
- `src/db/schema.ts`: unchanged `experiments` definition; other tables deferred. No fields or relationships redesigned.
- `src/migrations/`: generated from this one-table schema using Drizzle, with its own migration history for a new dsgnrd database. Do not point dsgnrd at an srchd database.
- Package dependencies and TypeScript options retain the relevant upstream choices. No model, runner, server, or computer dependencies are included.

Inherited behavior: duplicate names fail the unique constraint; an empty list exits with a not-found error; creation checks path existence, not problem contents. Relative paths resolve from the working directory. Run commands from the repository root. Folder inputs are accepted without reading `problem.md` at creation time. External paths remain absolute.
