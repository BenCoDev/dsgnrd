# Run an agent: implementation plan

Status: implemented on `feat/agent-run`; see `docs/agent-run-verification.md` for validation evidence and limitations.

Story: [OS-442 — Run an agent on an experiment’s problem](https://app.notion.com/p/3f4263c2e5188194896cec90042b6008).

Reference: dust-tt/srchd at `4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08`. Compare ports against this pinned version; the local srchd checkout is a walkthrough aid, not a replacement source of truth.

## Outcome

Run a saved designer against the Oldskaters brief with Anthropic Haiku, inspect its output and any tool results, stop after one tick, and continue its saved conversation in a new process. Preserve srchd’s runner and publication/review/solution mechanisms. Verify collaboration with multiple agents as a separate milestone within this implementation.

## 1. Database and resources

Retain existing `experiments`, `agents`, and `evolutions`. Add the upstream definitions and supporting resources for:

| Table | Purpose |
| --- | --- |
| `messages` | Ordered user/agent messages, including tool requests and results |
| `token_usages` | Reported model usage linked to an experiment, agent, and response |
| `publications` | Submitted work and its publication status |
| `reviews` | Assigned reviewers, grades, and review content |
| `citations` | References between publications |
| `solutions` | Agent reports identifying the best published solution, or withdrawing one |

Port `MessageResource`, `TokenUsageResource`, `PublicationResource`, and `SolutionResource`, plus the existing-resource methods they depend on. Reviews and citations retain their upstream resource organization; do not invent separate services or a run/session table.

Generate an additive migration and verify existing experiments, agents, and evolutions survive it. Keep upstream keys, constraints, statuses, and relationships.

## 2. Model execution

Bring over the common message/tool/usage types, `LLM` contract, and factory pattern. Implement the Anthropic execution branch for `claude-haiku-4-5`: request and response conversion, token counting, context limits, thinking configuration, usage conversion, and cost calculation.

Other recognized model names remain available as existing metadata, but attempting to run an unimplemented provider must produce an explicit error rather than silently substitute Anthropic. Apple and subscription-funded access remain separate stories.

Load the API key through the process environment using `tsx --env-file=.env`. Never put credentials in agent records, prompts, output, or committed files. Use a fake model for deterministic tests and Haiku for the live demonstration.

## 3. Runner and command

Port `Runner`, `RunConfig`, advisory handling, MCP in-memory client/server wiring, and supporting retry/error utilities. Add the upstream `agent run <name>` flow to `src/dsgnrd.ts`, including experiment selection, multi-agent selection, reviewer count, `--tick`, continuous execution, and token/cost stopping options.

Preserve the execution sequence:

1. Load the experiment, saved agent instructions, profile settings, and ordered history.
2. Initialize profile tools plus default tools.
3. Add automated input when needed, querying submitted publications and pending reviews.
4. Construct the system prompt from the problem and saved instructions.
5. Prepare history within model context constraints and call the model with upstream retry behavior.
6. Execute requested tools, preserving upstream concurrency.
7. Save the agent response, reported usage when available, and then tool results as a user message.
8. Stop after one tick or continue according to the upstream command behavior.

Tools execute before the agent response is persisted. Do not introduce atomicity or recovery guarantees absent upstream. Context pruning changes the request sent to the model, not stored history. Preserve empty-response behavior and warn when usage is unavailable.

Keep limit semantics faithful: continuous-run checks use experiment-wide totals and can overshoot; `--tick` follows its separate upstream branch. Explain these limits in the usage documentation.

## 4. Default collaboration tools

Port the `publications` and `goal_solution` servers and their existing handlers:

- List/read publications, submit work, list assigned reviews, list submitted work, and submit reviews.
- Report a best solution using a published reference, or a null reference with rationale.
- Preserve citation extraction and creation when a publication is published.

Preserve the upstream collaboration rules:

- Pending assigned reviews block new publication submissions.
- Reviewers are selected from other agents in the same experiment using upstream selection behavior.
- Too few eligible reviewers produces an error; the author cannot review its own submission through assignment.
- Only assigned reviewers can submit their reviews.
- A publication stays submitted until all assigned reviews arrive. Any reject/strong-reject rejects it; otherwise it is published.
- Explicitly configuring zero reviewers publishes directly through the existing upstream branch. Do not change the default reviewer count to make a single-agent test pass.
- Advisory notifications retain their upstream in-memory lifetime. Persisted review assignments and publication states remain the durable source of information.

The current design profile has no optional tools. Web access, computer execution, Kubernetes provisioning, and attachment transfer are outside this first supported profile. Isolate optional imports so these dependencies are not required for a no-computer run; keep the default handlers functional. Reject unsupported optional configurations explicitly, and document the port boundary in `docs/upstream.md`. Any change that would alter the collaboration algorithm or core orchestration requires discussion with Ben first.

## 5. Design instructions and existing agent

Expand `agents/design/prompt.md` to explain publications as design proposals, reviews as evaluations against the brief, citations as building on earlier proposals, and solution reports as identifying the strongest published proposal. Preserve the review grades and tool contracts.

Use the same automated runner behavior while adapting research-specific wording to design work. Do not suggest that a finished conversational answer changes shared state: publication and review tools do that.

Provide and document a deliberate update of the existing designer’s saved instructions using the upstream evolution mechanism. Append an evolution and retain previous instructions and message history. Editing the profile alone is insufficient. This setup operation does not enable autonomous prompt editing.

## 6. Verification

### Deterministic checks

- Migration preserves existing records and enforces message order uniqueness.
- Input contains the correct problem, saved instructions, history, publications, and pending reviews.
- A fake model tool request executes the correct handler; response, usage, and tool results have the correct ordering and ownership.
- Reinitializing a runner reloads saved history, including prior tool results.
- Cover plain-text output, empty responses, unavailable usage, and model/tool errors.
- Exercise collaboration rules: pending-review blocking, insufficient reviewers, author exclusion, assigned-review validation, waiting for all reviews, accept/reject outcomes, zero-reviewer publishing, citations, and solution reporting restrictions.
- Verify existing experiment/agent tests, type checking, and relevant CLI errors still pass.

### Live milestone A: one agent and continuation

Configure the saved designer to use Haiku and updated instructions. Run:

```sh
npx tsx --env-file=.env src/dsgnrd.ts agent run designer \
  -e oldskaters-reveal --reviewers 0 --tick
```

Inspect output, ordered message records, and available usage. Invoke the same command in a new process and verify history continuation. One tick may end with tool results rather than a finished proposal. This verifies execution and persistence, not peer review.

### Live milestone B: collaboration

Create at least two design agents in a separate demonstration experiment using the same brief, with one required reviewer. Run turns until one submits work, the other receives and completes the assigned review, and the publication changes status. Inspect the saved review and citation relationships when present. Verify a valid solution report through the real handler; report separately whether the live model chose to call it. Reviewer assignment does not itself start an idle agent; explicitly run the participating agents through the upstream command flow.

Use bounded ticks for the demonstration. Test continuous stopping behavior separately with deterministic fixtures; avoid an unattended paid run as a test prerequisite. Report any live behavior that was not actually observed.

## 7. Documentation and completion

In the schema change, update affected README descriptions, Mermaid sources, and SVG exports under `docs/diagrams/`. Keep the srchd reference diagrams faithful to the pinned upstream version and distinguish dsgnrd’s implemented subset.

Update `docs/upstream.md` with copied portions and explicit omissions. Document key setup, instruction updates, single-agent and collaboration commands, continuation, stopping, record inspection, missing usage, and failure cases.

Complete when both execution/continuation and collaboration behavior are verified, required checks pass, and Ben can trace the brief through the API call, tool effects, and stored exchange. Do not mark collaboration verified solely because the default tool names are present.
