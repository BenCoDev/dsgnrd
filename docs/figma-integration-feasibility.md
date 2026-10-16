# OS-453: Figma integration feasibility

Source: [Let design agents create their proposals in Figma](https://app.notion.com/p/3fa263c2e51881fc841af91050c97f2f).

Investigation date: 2026-10-16. The optional agent tool is implemented through Figma Console MCP's local Desktop Bridge. Both the standalone proof and a two-agent deterministic fixture passed with real native frames, saved screenshots, publications, peer reviews, and revision. See [agent integration evidence](figma-tool-walkthrough.md#agent-integration).

**Current direction:** Remote MCP + OAuth remains Ben's preferred experience. After learning that remote client onboarding is paused, Ben requested a working path today and installed the Desktop Bridge in the designated test file. The local proof is now verified. See [the walkthrough and registration findings](figma-tool-walkthrough.md#verified-remote-oauth-discovery) for the still-unresolved remote route.

**Remote OAuth status: blocked by external client onboarding.** On 2026-10-16, Ben supplied a screenshot of Figma's linked request form stating that the form is deprecated and new remote MCP client onboarding is paused. It directs public-client requests to a replacement form and private/internal-client requests to a Figma account manager. Neither route establishes approval for dsgnrd. No request was submitted. Local bridge testing can proceed independently.

## Existing tool flow

1. `src/agent_profile.ts` reads a profile's `settings.json` and validates its optional tool names against `src/tools/constants.ts`.
2. `Runner.builder()` passes the experiment, agent and run configuration to `src/tools/index.ts`, which creates each selected MCP server plus the default publication and solution servers.
3. `src/lib/mcp.ts` pairs each server with a client using in-memory transports.
4. `Runner.tools()` discovers schemas and exposes names such as `mobbin-search_screens` to the model. `tick()` supplies those schemas, the brief and the saved conversation to the model.
5. `Runner.executeTool()` dispatches the model's tool calls. The tick persists the model message and tool results through `MessageResource`; image evidence can be displayed by the dashboard.
6. Publications and peer reviews remain separate tools with the existing reviewer assignment and storage behavior.

The core flow comes from the pinned srchd version documented in [upstream.md](upstream.md). Mobbin is a dsgnrd addition: its local server authenticates to a remote MCP service, filters discovery to three searches, forces JPEG previews and normalizes returned evidence. Its successful integration does not establish that Figma permits the same custom-client authentication.

## Connection options and evidence

| Option | Documented capability | Prerequisite / unresolved point |
| --- | --- | --- |
| Official remote Figma MCP | `use_figma` creates and edits native content via the Plugin API; remote connection does not require Figma Desktop. | Approved clients only. The linked waitlist is deprecated and its notice says new-client onboarding is paused (Ben's screenshot, 2026-10-16). dsgnrd has no verified access. Writing requires an eligible plan and edit access. |
| Third-party Figma Console MCP, local mode | A local MCP process communicates with a Desktop Bridge plugin to create and edit native content. | Requires Figma Desktop and the plugin running in the target file. Standalone create/inspect/edit and client reconnect verified without REST credentials. App restart, ownership boundaries, and ambiguous writes remain unverified. It is not a headless alternative. |

Primary sources checked:

- [Official remote setup and custom-client restriction](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Official native canvas writing and access requirements](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)
- [Figma Console MCP source and setup](https://github.com/southleft/figma-console-mcp)

The assistant's connected Figma tools are not a connection available to dsgnrd. Do not copy host credentials or impersonate an approved client to fill this gap.

## Implementation boundary

The optional Figma server preserves profile → factory → in-memory MCP → runner and all publication/review rules. Desktop Bridge adds an external runtime dependency without replacing the agent orchestrator.

The adapter enforces exact file/page and agent ownership, serializes dsgnrd calls per file, and returns PNG evidence through existing messages. A pending operation is never automatically retried.

The adapter must enforce the configured destination and each agent's writable proposal area. Peer inspection must remain possible. Passing unrestricted model-authored Plugin API code through a generic execution tool would not enforce ownership; prompt instructions alone cannot satisfy that acceptance criterion.

Writes need stable operation identities and destination reconciliation after ambiguous failures. Existing runner persistence occurs after tool effects, so persisted conversation history alone cannot establish that a timed-out creation did not succeed. Do not retry creation blindly. Save visual observations in messages so later edits do not replace a reviewer's original evidence.

Destination configuration and operation intent/results are stored in two additive tables, `figma_destinations` and `figma_operations`. Ownership/revision markers live on Figma nodes. README schema descriptions, the implemented Mermaid source, and its SVG export were updated; the upstream reference is unchanged.

## Verification and limits

- Offline tests cover boundaries, peer reads, lost responses, server restart/reconciliation, stable replay, partial writes, and concurrent duplicate requests.
- The live two-agent fixture exercised creation → publication → peer inspection/review → revision through the real runner and database. The resulting layers remain editable.
- Autonomous model design quality, Figma app restart during writes, and human edits concurrent with agent writes are not proven. There is no automatic partial-write rollback.

No paid model calls were used. The live fixture uses scripted model responses; it verifies the agent integration without claiming autonomous design quality.
