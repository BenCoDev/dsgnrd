# Objective

This is a learning project to explore how agents can cooperate in design collaboration, drawing on the [dust-tt/srchd](https://github.com/dust-tt/srchd) project.

# How to start - Create an experiment from a demo problem

Requires Node.js 24.15+ and npm 12+. With nvm installed, run from this repository:

```bash
nvm install
nvm use
npm install --global npm@12.0.2
npm ci
npm run migrate

npx tsx src/dsgnrd.ts experiment create oldskaters-reveal \
  -p problems/oldskaters/trick-reveal
npx tsx src/dsgnrd.ts experiment list
```

The included [Oldskaters problem](problems/oldskaters/trick-reveal/problem.md) explores trick-video aspect ratios while preserving the fun of the reveal. Use another experiment name to repeat the exercise.

You should see `oldskaters-reveal` with `oldskaters/trick-reveal` as its stored problem reference. The command passes the folder containing `problem.md`, following srchd's folder convention. Creation checks that the path exists and saves it; it does not read or copy the problem text. No agents run and no model credentials are needed.

Use `-p /absolute/path/to/your/problem.md` for your own file. Like srchd, folder inputs are also accepted; `problem.md` and optional `data/` are used later when agents run. A nonexistent path fails without creating a record. Names must be unique. Listing an empty database returns a not-found error, as in srchd.

Commands use `./db.sqlite` by default. To use another **dsgnrd** database, set `DATABASE_PATH` to the same path for migration and every command. Keep it separate from srchd's database and run commands from this repository root.

# Create an agent

```bash
npx tsx src/dsgnrd.ts agent create -e oldskaters-reveal -n designer -p design
npx tsx src/dsgnrd.ts agent list -e oldskaters-reveal
```

The [design profile](agents/design/prompt.md) supplies the instructions; the agent stores its experiment, name, profile, model, and thinking setting. Its first `evolutions` record saves those instructions. Defaults match srchd: `-m claude-sonnet-5 -t low -c 1`. Here `-p` means profile. Creation makes no model calls and needs no credentials.

# Run an agent

Run migrations first. Add `ANTHROPIC_API_KEY` to a local `.env` file (ignored by Git). The runner uses the model saved at agent creation; this slice implements Anthropic execution. Other provider names are recognized at creation but their execution is deferred and fails explicitly.

For a new agent, choose a supported model when creating it, for example:

```bash
npx tsx src/dsgnrd.ts agent create -e oldskaters-reveal -n designer -p design \
  -m claude-haiku-4-5 -t low
```

Skip creation if that agent already exists. Inspect its saved configuration with `agent list`. To update an existing agent's instructions after changing the profile:

```bash
npx tsx src/dsgnrd.ts agent instructions designer -e oldskaters-reveal \
  -f agents/design/prompt.md
```

This appends an evolution and preserves earlier instructions and messages. The new instructions apply when the agent is loaded again. An already-running process keeps its loaded instructions. Agents do not receive autonomous self-editing tools.

Run one turn, then run the same command again to continue:

```bash
npx tsx --env-file=.env src/dsgnrd.ts agent run designer \
  -e oldskaters-reveal --reviewers 0 --tick
```

A tick is one model response (with possible retries) plus its requested tool executions. The next tick lets the model interpret the saved tool results. A completed text response is not guaranteed on the first tick. The model receives the brief and saved instructions separately from its ordered conversation. Pruning long context does not delete database history.

`--reviewers 0` explicitly selects srchd's direct-publication branch for a single-agent exercise. The upstream default remains **4** other reviewers. With fewer available agents, submission returns a tool error; it does not silently publish. Tool errors are saved for the model to handle; model/input failures stop the command.

## Verify collaboration

Create a second named design agent with its model selected at creation. Use `--reviewers 1` for both agents, either alternating bounded ticks or running all agents:

```bash
npx tsx src/dsgnrd.ts agent create -e oldskaters-reveal -n critic -p design \
  -m claude-haiku-4-5
npx tsx --env-file=.env src/dsgnrd.ts agent run all \
  -e oldskaters-reveal --reviewers 1 --tick
```

Repeat bounded ticks as needed: the author submits, the reviewer reads and reviews, and the author observes the outcome. Review assignment does not start an idle agent. Pending assigned reviews block new submissions. All assigned reviews must arrive; any rejection rejects the publication, otherwise it publishes. Only published work can be reported as the best solution. Citations use bracketed publication references in content.

Advisories are in-memory notifications within a process, as upstream. Persisted assignments and statuses survive restart and are available through tools and newly constructed automated inputs. A tick consuming an existing tool result does not automatically refresh all publication statuses.

Without `--tick`, each selected agent runs continuously until failure or interruption. Stop with Ctrl-C. Optional `--max-tokens` (millions) and `--max-cost` (dollars) check experiment-wide accumulated usage periodically, may overshoot, and are not a hard billing cap. The `--tick` branch does not check these limits. Costs use upstream estimates and the agent's current model, not an invoice; usage without provider reporting is skipped with a warning. Anthropic's `thinking: 0` is not proof that no thinking tokens were used.

The implementation preserves upstream ordering: tool side effects happen before the agent response is saved, then usage and tool results are stored separately. There is no atomic exchange or automatic crash recovery guarantee. Avoid concurrently running the same agent in multiple processes: message positions are unique within its experiment/thread.

## Inspect saved records

```bash
sqlite3 -header -column db.sqlite 'SELECT agent, position, role, content FROM messages ORDER BY agent, position;'
sqlite3 -header -column db.sqlite 'SELECT agent, message, input, output, cached, total FROM token_usages;'
sqlite3 -header -column db.sqlite 'SELECT reference, author, title, status FROM publications;'
sqlite3 -header -column db.sqlite 'SELECT publication, author, grade, content FROM reviews;'
sqlite3 -header -column db.sqlite 'SELECT agent, publication, reason, content FROM solutions;'
```

The supported design profile has no optional tools; its default tools are publications and solution reporting. Web/computer tools, Kubernetes, file attachment transfer, the web UI, replay/cleanup commands, other provider execution, Apple, and subscription integrations remain deferred. The run command rejects profiles with optional tools.

Validation: `npm run typecheck` and `npm test`. Tests use isolated databases, actual MCP handlers, fake model responses, and intercepted SDK requests; they need no credentials or paid calls. See [verification evidence](docs/agent-run-verification.md) and [upstream provenance](docs/upstream.md).

# Learning from srchd

To optimise for learning, I chose to preserve srchd's architecture as much as possible. The same relationships connect agents, their contributions, their reviews, and the solutions they currently favor.

**Status:** all nine tables shown below are implemented, including the runner’s conversation/usage storage and the publication/review/solution resources. See the [implemented schema](docs/diagrams/dsgnrd-current.svg) ([Mermaid](docs/diagrams/dsgnrd-current.mmd)). The design meanings preserve srchd's table names and relationships. `experiments.problem` stores a file or folder reference, not the brief text.

The full model is shown in the same two views as the Notion diagrams: collaboration, then agent history and usage. Both columns preserve the same fields and relationships. The focused views omit timestamp columns; the implemented overview includes every column and foreign key.

<table>
  <tr>
    <th width="50%">srchd · Research collaboration</th>
    <th width="50%">dsgnrd · Design collaboration</th>
  </tr>
  <tr><th colspan="2">Research and collaboration</th></tr>
  <tr>
    <td valign="top"><a href="docs/diagrams/srchd-model.svg"><img src="docs/diagrams/srchd-model.svg" alt="srchd collaboration ER diagram with fields, keys, and relationships for experiments, agents, publications, reviews, citations, and solutions." width="100%"></a></td>
    <td valign="top"><a href="docs/diagrams/dsgnrd-model.svg"><img src="docs/diagrams/dsgnrd-model.svg" alt="Implemented dsgnrd interpretation with the same six collaboration tables, fields, keys, and relationships." width="100%"></a></td>
  </tr>
  <tr><th colspan="2">Agent history and usage</th></tr>
  <tr>
    <td valign="top"><a href="docs/diagrams/srchd-history.svg"><img src="docs/diagrams/srchd-history.svg" alt="srchd history ER diagram with fields, keys, and relationships for agents, evolutions, messages, and token usages." width="100%"></a></td>
    <td valign="top"><a href="docs/diagrams/dsgnrd-history.svg"><img src="docs/diagrams/dsgnrd-history.svg" alt="Implemented dsgnrd history with the same agents, evolutions, messages, and token usage tables, fields, keys, and relationships." width="100%"></a></td>
  </tr>
</table>

Click a diagram to open it at full size.

Composite uniqueness constraints are unchanged:

| Table          | Unique columns                      |
| -------------- | ----------------------------------- |
| `agents`       | `experiment` + `name`               |
| `publications` | `experiment` + `reference`          |
| `reviews`      | `author` + `publication`            |
| `citations`    | `experiment` + `from` + `to`        |
| `messages`     | `experiment` + `agent` + `position` |

`experiments.name` is also unique. The foreign keys alone do not enforce that linked records belong to the same experiment.

Source: [srchd's database schema](https://github.com/dust-tt/srchd/blob/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08/src/db/schema.ts), checked on 2026-10-09. Editable Mermaid sources: [srchd collaboration](docs/diagrams/srchd-model.mmd) · [dsgnrd collaboration](docs/diagrams/dsgnrd-model.mmd) · [srchd history](docs/diagrams/srchd-history.mmd) · [dsgnrd history](docs/diagrams/dsgnrd-history.mmd). SVG exports keep each comparison side by side in the README.
