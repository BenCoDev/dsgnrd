# Design-finisher implementation and live test

This change builds on PR #9. It keeps the existing experiment, agent, publication, review, solution, and Runner architecture. `design-finisher` is a profile, not a new entity. No database schema changes are required.

## How it works

1. Select a published source and save its reference, frame/revision, constraints, and source reviews in a new agent's instructions. The profile refuses to silently substitute another source.
2. Supply any local PNG/JPEG assets through `DSGNRD_FIGMA_ASSETS`. Agents discover filenames and source dimensions through `list_assets`; they cannot fetch arbitrary URLs or read arbitrary paths.
3. Start the finisher and a designated reviewer in the same experiment. Set `reviewerAgentIds` in the publication server's existing run configuration so old, inactive participants do not receive the new reviews. Without that option assignment behaves as before.
4. Advance ordinary Runner ticks. The finisher creates its own frames, publishes, receives a substantive review, revises, and receives final verification. The reviewer inspects the actual frame revision and screenshot.
5. Report the result and unresolved issues. Static designs do not imply functioning video, transitions, accessibility behavior, or user validation.

The experimental harness waits to advance the reviewer until a review is assigned, avoiding paid idle polling. The corrected harness stops immediately after the second review, at its tick limit, on failure, or before exhausting its shared allowance. No generic scheduling or auto-handoff system is introduced.

## Tool changes

Scenes now support nested frames, fixed-size horizontal/vertical auto layout, child fill sizing, Inter weights/line heights/letter spacing, image fills, native components and instances, and reusable local paint styles. Components must precede their instances. Instance overrides are not supported. Layout coordinates are local to the parent; auto-layout parents compute child positions. NONE is accepted for absolute positioning, matching inspection output. Image inspection exposes FIT/FILL mode so reviewers can compare it with the asset aspect ratio.

Limits: 120 declared nodes, 300 expanded nodes, four nesting levels, roots up to 1600×1600, eight image assets / 8MB total per scene. Each image is at most 2MB and 1600px per dimension. Assets must be regular files inside the operator-configured directory; symlinks and path traversal are rejected.

Revision replaces managed descendants while preserving the root frame. Descendant IDs and component identities can therefore change; do not use these experimental components as a published shared library. Recursive ownership checks protect human additions inside nested frames. Existing operation intent, reconciliation, scope, ownership, and stale-revision protections remain in effect. Asset bytes are loaded once for a write and excluded from the operation request; completed calls replay their saved evidence even if a source asset later changes.

## Validation

The VM-backed Plugin API test exercises nested frames, components/instances, supplied images, styles, fill sizing, revisions, and protection of human-added nested layers. Negative cases cover missing images, invalid references, symlinks, and traversal. Publication tests verify designated reviewers, self/foreign-agent exclusion, and unchanged default assignment.

A real Desktop Bridge check created and revised frame `17:242` in the authorized test file, successfully returning a PNG after revisions 2 and 3. It contains a native component and instance, auto layout, a named paint style, and a real skate still. This check used no model calls.

## Live polishing test

- Existing experiment: `oldskaters-four-agents-10usd` (ID 2).
- Source: `[hksy]`, “The Shared Stage”, frame `8:83`, revision 1.
- Finisher: `shared-stage-finisher`, Opus 5 (agent 7).
- Reviewer: `shared-stage-finish-reviewer`, Sonnet 5 (agent 8).
- New allowance: **$10 total**, separate from the previous exploration spend.
- Imagery: one frame extracted from a public Oldskaters kickflip clip. Repetition must be disclosed; it is not evidence of several distinct skaters.
- Local harness and accounting: `.local/figma-finishing-10usd/` (ignored; includes source assignment, run script/log, budget ledger, and results).

The bounded harness disables SDK retries, counts input before sending, reserves conservatively for the maximum request/output, and records usage after every paid request. Unknown outcomes consume their reservation and stop the run. A pre-existing ledger prevents accidental paid reruns. The normal CLI has no dollar-budget enforcement, and this test does not implement crash-safe generic resume.

The first submission `[eli9]` was rejected for concrete visual defects, including footer text crossing a component photograph and a return-to-solo heading colliding with the image. Revision 2 fixes those overlaps and reorganizes the board. Three invalid scene writes were rejected before mutation: a child outside its parent, unsupported `layout: NONE`, and instance definitions ordered before their components. One transient inspection failure recovered on a read retry; no uncertain write was repeated.

This exposed usability gaps in the tool. The final implementation accepts NONE, names offending layers in bounds/reference errors, returns component keys and image fit mode during inspection, and includes asset dimensions in discovery. The live agents retained their startup schemas, so those improvements were checked separately against the actual Desktop Bridge (proof frame revision 3) and automated tests; they were not silently credited as part of the paid agents' recovery.

## Outcome

The reviewer rejected `[eli9]` (publication 10, revision 1), then **accepted `[6wv0]`** (publication 11, revision 2). Final read-only verification at 2026-10-16 12:16 UTC confirmed source `8:83` still at revision 1 and final `17:259` at revision 2, 1560×1560. No pending operations remain.

- [Accepted Figma frame](https://www.figma.com/design/VEo8vKvbwyh7YiEnXbGkAj?node-id=17-259)
- [Local publication and review](http://localhost:1337/experiments/2/publications/11)
- Saved PNGs: [source](evidence/design-finisher/source.png), [first pass](evidence/design-finisher/first-pass.png), [accepted revision](evidence/design-finisher/accepted-revision.png)
- [Run outcome and full reviews](evidence/design-finisher/result.json); [budget ledger](evidence/design-finisher/budget.json)

**Accounted upper bound: $5.7137785 of $10.** There were 28 issued model requests: 27 returned usage accounting for at most $4.7089785, and one in-flight request was interrupted during shutdown. Its full $1.0048 reservation is counted as spent, rather than assuming cancellation was free. Exact billing for that request is unknown. No paid rerun was started.

### Stopping-condition finding

The initial harness waited for both final review and an agent solution report. After acceptance the generic Runner continued asking for work, and the finisher attempted two unnecessary revisions (both rejected by validation, no canvas mutation), then performed read/reconciliation checks. Its unsupported explanation that the root was only 1420px tall was false: final inspection confirms 1560px. The process was stopped with no pending writes. No agent solution report was produced; publication 11 and its ACCEPT review are the final handoff.

The corrected local harness ends on final verification itself:

```ts
const finalReviewed = reviews.filter(r => !!r.grade).length >= 2;
if (finalReviewed) break;
```

Do not use a profile's instruction to “stop” as a budget or lifecycle boundary. The generic Runner is intentionally unchanged. A bounded harness must enforce the boundary before another author tick. Inspection now also returns root width/height to make dimension checking explicit.

### How far it got

The pass produces a substantially more legible static presentation, real imagery, native editable layers/components, stronger visual hierarchy, and explicit mobile/wide/return states. The reviewer caused useful geometry fixes rather than simply approving the first result.

It is **not a production-final design**. The supplied still is 360×262; the portrait nodes use FILL, so they crop the source image. The agents checked frame aspect ratios but did not establish that footage was uncropped. The narrow fifth image is another cropped fill, not a proven off-screen slice of an unchanged full-width clip. One rider is repeated throughout, labels are not verified metadata, the wide state is scaled down, and interactions/motion/responsive behavior remain static descriptions. Agent acceptance is evidence of a review cycle, not proof of these claims.

The image came from [the public Oldskaters kickflip clip](https://jjztguovyndwypootzcy.supabase.co/storage/v1/object/public/tricks/recFsenB7SrrUwLlK_kickflip_recy2a77KJcAAjcJ3). The final tool/profile improvements expose dimensions and crop mode and explicitly distinguish FIT from FILL, but the paid design was not rerun after those improvements.

Validation: 22 automated tests passed, followed by passing focused tests for the final metadata/layout changes; TypeScript and whitespace checks pass. The actual Desktop Bridge check verified native components, auto layout, styles, supplied imagery, NONE layout, and revision, and the final read-only check verified root dimensions and image fit metadata.

![Accepted static board, revision 2](evidence/design-finisher/accepted-revision.png)
