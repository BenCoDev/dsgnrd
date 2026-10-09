# Objective

This is a learning project to explore how agents can cooperate in design collaboration, drawing on the [dust-tt/srchd](https://github.com/dust-tt/srchd) project.

## From research to design

The aim is to preserve srchd's architecture and learn by adapting its problems, prompts, and content to design collaboration. The same relationships connect agents, their contributions, their reviews, and the solutions they currently favor.

**Status:** dsgnrd is at the documentation stage. Its chart below is a proposed interpretation of srchd's existing model, not an implemented schema. The table names and relationships stay the same; the descriptions show how their content could translate into design work.

The full model is shown in the same two views as the Notion diagrams: collaboration, then agent history and usage. Both columns preserve the same fields and relationships.

<table>
  <tr>
    <th width="50%">srchd · Research collaboration</th>
    <th width="50%">dsgnrd · Proposed design interpretation</th>
  </tr>
  <tr><th colspan="2">Research and collaboration</th></tr>
  <tr>
    <td valign="top"><a href="docs/diagrams/srchd-model.svg"><img src="docs/diagrams/srchd-model.svg" alt="srchd collaboration ER diagram with fields, keys, and relationships for experiments, agents, publications, reviews, citations, and solutions." width="100%"></a></td>
    <td valign="top"><a href="docs/diagrams/dsgnrd-model.svg"><img src="docs/diagrams/dsgnrd-model.svg" alt="Proposed dsgnrd interpretation with the same six collaboration tables, fields, keys, and relationships." width="100%"></a></td>
  </tr>
  <tr><th colspan="2">Agent history and usage</th></tr>
  <tr>
    <td valign="top"><a href="docs/diagrams/srchd-history.svg"><img src="docs/diagrams/srchd-history.svg" alt="srchd history ER diagram with fields, keys, and relationships for agents, evolutions, messages, and token usages." width="100%"></a></td>
    <td valign="top"><a href="docs/diagrams/dsgnrd-history.svg"><img src="docs/diagrams/dsgnrd-history.svg" alt="Proposed dsgnrd history with the same agents, evolutions, messages, and token usage tables, fields, keys, and relationships." width="100%"></a></td>
  </tr>
</table>

Click a diagram to open it at full size. **PK** = primary key, **FK** = foreign key, **UK** = unique key. Relationship endpoints indicate exactly one, zero or one, or zero or many.

All nine tables are represented; `agents` appears in both views. As in the Notion charts, the shared `created` and `updated` timestamps and repeated experiment relationships are omitted. Every table other than `experiments` has a required experiment foreign key, shown in its field list.

A citation connects a citing publication (`from`) to a cited publication (`to`). A solution records an agent's current position and rationale, with an optional publication reference; it is not a final human decision. `solutions.content` is the SQL column for the TypeScript property `rationale`. Review grade and content can be null while a review is pending. Message content is JSON stored as SQLite text.

Composite uniqueness constraints are unchanged:

| Table | Unique columns |
| --- | --- |
| `agents` | `experiment` + `name` |
| `publications` | `experiment` + `reference` |
| `reviews` | `author` + `publication` |
| `citations` | `experiment` + `from` + `to` |
| `messages` | `experiment` + `agent` + `position` |

`experiments.name` is also unique. The foreign keys alone do not enforce that linked records belong to the same experiment.

Source: [srchd's database schema](https://github.com/dust-tt/srchd/blob/4b5ffb44bdc6bb1d2181d746ec951dd30f89ed08/src/db/schema.ts), checked on 2026-10-09. Editable Mermaid sources: [srchd collaboration](docs/diagrams/srchd-model.mmd) · [dsgnrd collaboration](docs/diagrams/dsgnrd-model.mmd) · [srchd history](docs/diagrams/srchd-history.mmd) · [dsgnrd history](docs/diagrams/dsgnrd-history.mmd). SVG exports keep each comparison side by side in the README.
