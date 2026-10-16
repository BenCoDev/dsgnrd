# OS-453: tool-flow walkthrough and connection proof

Story: [Let design agents create their proposals in Figma](https://app.notion.com/p/3fa263c2e51881fc841af91050c97f2f).

Implementation base: `c1b3a2e` on `main`, including the merged Mobbin integration. Investigation started 2026-10-16.

**Latest result:** The optional agent adapter is implemented and the [two-agent integration fixture](#agent-integration) passed with the local bridge. Remote OAuth remains blocked. Earlier connection-gate notes below describe the remote route and the initial unsuccessful local probe.

## What happens when an agent uses a tool

1. `src/agent_profile.ts` validates the profile's optional tool names against `src/tools/constants.ts`. The profile is saved with the agent.
2. `Runner.builder()` in `src/runner/index.ts` checks supported optional tools and asks `src/tools/index.ts` to create those servers plus the default publication and solution servers.
3. `createClientServerPair()` in `src/lib/mcp.ts` connects each server to an MCP client through an in-memory transport. This is the existing orchestration boundary.
4. `Runner.tools()` discovers tool schemas and prefixes names with the server name. For example, the model sees `mobbin-search_screens`.
5. During a tick, the model receives these schemas and conversation context. Its tool calls are dispatched by `Runner.executeTool()`. Up to eight calls execute concurrently.
6. After the tool effects finish, the runner saves the assistant message and the tool-result message through `MessageResource`. Text and supported images can remain in the conversation and dashboard.
7. Publishing and peer review happen through the existing publication tools. A Figma frame link is evidence attached to that collaboration, not a replacement publication or review mechanism.

## What Mobbin adds

`src/tools/mobbin.ts` creates a local MCP server that forwards three allowed search tools to Mobbin's remote MCP service. `src/integrations/mobbin.ts` owns OAuth and account locking. The adapter normalizes text and image evidence before returning it to the runner.

Figma can reuse this placement in the system. Mobbin's OAuth registration and search retry behavior do not establish Figma client access or safe write retries.

## What Figma needs to add

- A verified external connection, behind an optional local `figma` server.
- Experiment-bound file/page configuration and adapter-enforced ownership of proposal areas.
- Structured creation and mutation operations that cannot reach arbitrary peer or unrelated nodes.
- Read access to peer proposals, returning frame links and actual rendered evidence.
- Write coordination within the adapter, including across processes if experiments run separately.
- Durable operation identities and destination reconciliation. The current runner saves messages after effects, so conversation persistence alone cannot resolve a timed-out write.

The runner's supported-tool check now admits `figma`, with a bounded request timeout. Its execution loop and collaboration mechanisms stay intact. The two additive integration tables are documented in README and included in the implemented diagram's Mermaid source and SVG export.

## Connection gate

**Preferred long-term direction (Ben, 2026-10-16): official remote MCP with OAuth, following Mobbin's user experience. The initially set-aside Desktop Bridge was subsequently enabled for the local proof described below.**

**Status: blocked by Figma's client-onboarding pause.** The [official Figma remote setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) limits connections to approved clients and links a waitlist. However, Ben's screenshot of that form on 2026-10-16 shows a deprecation notice and says new-client onboarding is paused. Access from this assistant is not access from dsgnrd. OAuth remains the intended approach; Desktop Bridge is set aside.

### Verified remote OAuth discovery

Public metadata retrieved without credentials on 2026-10-16:

| Setting | Advertised value |
| --- | --- |
| Resource | `https://mcp.figma.com/mcp` |
| Authorization server | `https://api.figma.com` |
| Authorization endpoint | `https://www.figma.com/oauth/mcp` |
| Registration endpoint | `https://api.figma.com/v1/oauth/mcp/register` |
| Token endpoint | `https://api.figma.com/v1/oauth/token` |
| Scope | `mcp:connect` |
| PKCE method | `S256` |
| Relevant grants | `authorization_code`, `refresh_token` |
| Advertised token authentication | `client_secret_basic`, `client_secret_post` |
| State required | `true` |

Sources: [protected-resource metadata](https://mcp.figma.com/.well-known/oauth-protected-resource), [authorization-server metadata](https://api.figma.com/.well-known/oauth-authorization-server).

Discovery is successful; registration, user authorization, and remote tool access remain unverified. No registration request has been sent. Metadata advertising a registration endpoint does not establish that it accepts unapproved clients.

Mobbin currently requests `openid`, dynamically registers a loopback callback, and advertises token authentication `none`. Figma advertises a different scope and secret-based token authentication. Reuse the local login, secure credential storage, refresh coordination, and MCP adapter patterns, but obtain Figma's approved client registration details before implementing its provider. Confirm permitted loopback redirects, whether registration is dynamic or provisioned, and client-secret requirements for this local CLI. Do not embed a shared application secret in source.

Creating a normal [REST API OAuth app](https://developers.figma.com/docs/rest-api/oauth-apps/) is not documented as granting remote MCP access; those docs describe a separate API authorization workflow.

### Access-request draft (not submitted)

Figma links new clients to this [deprecated MCP client request form](https://form.asana.com/?d=10497086658021&k=kBG-ejRQTdY8x_H6a4vM3Q). Its notice, shown in Ben's screenshot on 2026-10-16, directs public MCP clients/gateways to a replacement form and private/internal clients to their Figma account manager. The replacement URL was not recovered from the screenshot. dsgnrd's current personal learning scope most closely matches the private route; this is our interpretation, not a classification confirmed by Figma. No request was submitted. Retain this draft for a future supported access route:

> dsgnrd is a personal learning project exploring how design agents cooperate, using the existing srchd architecture. We would like to connect our TypeScript/Node MCP client to Figma's official remote MCP server through OAuth. The intended workflow is to create native editable proposals in a designated test file, inspect screenshots, publish frame links, and revise proposals following peer feedback. We need create, inspect, and edit capabilities without Figma Desktop running. Can dsgnrd be approved as a client, and what registration, redirect-URI, token-authentication, and refresh requirements should a local CLI follow?

Resume condition: Figma provides an approved access route and registration details for dsgnrd. Then implement and verify `figma login` and a standalone create → inspect → edit cycle in the existing test file. The target command is proposed; it does not exist yet. Remote integration work is blocked pending that external change; no Desktop Bridge setup is requested.

### Historical local-bridge investigation (set aside)

The initial candidate for a standalone local proof was [Figma Console MCP](https://github.com/southleft/figma-console-mcp), pinned to `1.40.9` for investigation. Its Desktop Bridge requires Figma Desktop and a running plugin in the target file. This external runtime dependency leaves the existing agent orchestration intact; it does not establish support for fully unattended runs. The source supports bridge-based screenshots without a REST token; REST-backed capabilities have separate token requirements.

`scripts/figma-probe.mjs` connects as `dsgnrd-figma-proof`, discovers the actual creation/inspection schemas, and calls the status tool. It does not load the project's `.env`, call models, or mutate the canvas. Run with the installed server entrypoint:

```sh
node scripts/figma-probe.mjs /path/to/figma-console-mcp/dist/local.js
```

The third-party server itself starts a local WebSocket listener and may install its bridge files under `~/.figma-console-mcp/plugin/`. Import its manifest in Figma Desktop and run the plugin in the designated test file. Discovery succeeding is not proof that the bridge is connected or that writing works.

## Live proof still required

### Observed connection result (2026-10-16)

- The standalone dsgnrd probe connected to Figma Console MCP `1.40.9` and discovered `figma_execute`, `figma_get_status`, `figma_list_open_files`, `figma_capture_screenshot`, and `figma_take_screenshot`.
- The server started its local listener on port 9223. Status reported `transport.active: "none"`, `websocket.available: false`, and `setup.valid: false`: no Desktop Bridge plugin was connected. The probe closed its connection after discovery.
- The server installed the bridge manifest at `/Users/benoitcotte/.figma-console-mcp/plugin/manifest.json` (bundled plugin version `1.39.0`).
- With Ben's authorization and selection of Ben Workspace, the assistant's Figma connector created [dsgnrd — Figma integration test](https://www.figma.com/design/VEo8vKvbwyh7YiEnXbGkAj) in drafts. This only provisions the destination; it is not a successful dsgnrd write test.
- `figma_execute` accepts an explicit `fileKey`; screenshot tools discovered here do not. The eventual adapter must resolve inspection routing as well as write routing. Do not assume an active file matches the configured destination.

The following proof checklist was subsequently completed through the local bridge, as recorded below. The remote OAuth proof remains blocked.

1. Confirm an authorized file/page and a responsive connection to that exact file.
2. Inspect the destination before writes and create one uniquely identified test frame in a separate area.
3. Save its ID/link, editable layer structure, and a rendered screenshot.
4. Edit the same frame, inspect its structure again, and save the revised screenshot.
5. Reconnect and locate the same frame. Never rerun an uncertain creation without inspecting the destination.

At that point, ownership enforcement, ambiguous-write recovery, two-agent review/revision, and unattended operation were still unverified. The adapter and subsequent integration checks are documented below.

## Successful local proof

On 2026-10-16, the corrected connection probe waited for plugin discovery and received a successful active roundtrip (7 ms) from the designated test file. The earlier immediate check had closed before the running plugin could connect; it did not establish that Ben's setup was incomplete.

`scripts/figma-proof.mjs` then ran four separate standalone-client sessions, with no model calls and no assistant-host Figma credentials:

1. `inspect`: confirmed file `VEo8vKvbwyh7YiEnXbGkAj`, page `0:1`, and an empty destination.
2. `create`: created marked section `5:2`, native frame `5:3`, and editable text layer `5:4`. Saved and visually inspected [the original screenshot](figma-proof/create.png).
3. `edit`: reconnected, found the marked area, and changed the same text layer and frame fill. Saved and visually inspected [the revised screenshot](figma-proof/edit.png).
4. `check`: reconnected again and confirmed the same frame/text IDs and revised content. See [reconnect evidence](figma-proof/check.json).

[Open the editable proof frame](https://www.figma.com/design/VEo8vKvbwyh7YiEnXbGkAj?node-id=5-3). The proof exported PNGs inside the explicitly file-targeted execution call, avoiding reliance on an unscoped screenshot tool's active file. Every script checked the actual `figma.fileKey` before accessing nodes.

This is a deterministic smoke test, not the production agent adapter. It refuses to recreate an existing marked area and does not automatically retry failed writes. It does not yet prove concurrent-agent ownership enforcement or recovery from partial mutations. The server closes after each proof phase, so the plugin may display a waiting state between runs; leave the plugin open for subsequent sessions.

## Agent integration

The `design-figma` profile enables `create_proposal`, `revise_proposal`, `list_proposals`, `inspect_proposal`, and `reconcile_operation`. Server inputs are structured scene data; only fixed adapter scripts execute in Figma. Every operation checks the configured file and page. Each proposal has an author-owned section; peers can read, not revise. Revisions preserve dimensions and reject unrelated child layers.

Migration `0003_figma_tools.sql` adds one immutable destination per experiment and a durable write journal. An operation is recorded pending before external effects. Reconciliation reads matching completion markers without repeating mutations; completed operations replay the saved screenshot and inspection timestamp. Unknown or partial effects block further writes for that experiment. Calls serialize through a per-file lock across processes, and each process shares one external server. The default nine collaboration/history tables and review rules are unchanged.

The live fixture `scripts/figma-collaboration-proof.ts` used an isolated database and deterministic model responses. It verified both agents creating separate native frames, the author publishing a frame link, the peer inspecting/reviewing revision 1, the author reading that review and revising the same frame, and the peer inspecting/reviewing revision 2. Both publications reached `PUBLISHED`. The peer's earlier screenshot remained in the saved conversation after revision. Zero paid model calls.

- [Revised author frame](https://www.figma.com/design/VEo8vKvbwyh7YiEnXbGkAj?node-id=5-6)
- [Peer proposal](https://www.figma.com/design/VEo8vKvbwyh7YiEnXbGkAj?node-id=5-14)
- [Original peer observation](figma-proof/collaboration/peer-observation-v1.png)
- [Revised author screenshot](figma-proof/collaboration/author-v2.png)
- [Fixture report](figma-proof/collaboration/result.json)

Offline tests cover peer/foreign-node rejection, different file/page rejection, unrelated layers, stale revisions, concurrent duplicate calls, saved-result replay, and a lost write response followed by a new server and reconciliation. Partial outcomes without completion markers stay unresolved. This does not claim autonomous model quality or fully unattended operation; Figma Desktop and the plugin must remain open.

## Real-model experiments and proposal UI

Two authorized experiments subsequently used the real runner and Figma tools on the Oldskaters brief:

| Run | Model requests | Conservative API cost estimate | Publications | Completed / pending reviews |
| --- | --- | --- | --- | --- |
| Two Haiku 4.5 agents, $2 cap | 45 | $0.506113 | 4 | 3 / 1 |
| Two Opus 5 and two Sonnet 5 agents, $10 cap | 108 | $9.077959 | 5 | 9 / 1 |

The first run produced two revised main proposals and an additional interaction-state draft. The second stopped below its spending cap because the remaining allowance could not cover another reserved Opus request. These cost figures intentionally overestimate usage rather than representing provider invoices. Temporary run scripts and databases remain local under ignored `.local/`; the regular CLI still uses its existing periodic `--max-cost` checks, not those scripts' pre-request spending guards.

The agents created native layers, inspected screenshots, published proposals, and exchanged reviews. Results remain static wireframes with video placeholders. One reviewer inspected a newer frame revision than the publication described, and the agents made overly confident quality claims. The integration therefore demonstrates collaboration and editable output, not polished design, reliable publication-to-revision binding, or user validation. Neither experiment completed every assigned review.

The overview presents the latest publication for each linked set of author-owned frames as a design proposal, with author, review status, abstract, and saved preview. Text-only publications remain separate. Frames without a publication are excluded. Publication lists and details show saved screenshots matched to frame links and captured no later than the publication timestamp's stored second; later frame edits do not replace those previews. The original screenshots remain in agent conversations. Frame links open Figma, while proposal cards primarily open the publication for review.
