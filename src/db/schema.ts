import type { ThinkingConfig } from "@app/models";
import type { provider, Model } from "@app/models/provider";
import { sqliteTable, text, integer, unique, index } from "drizzle-orm/sqlite-core";

export const experiments = sqliteTable(
  "experiments",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    name: text("name").notNull(),
    problem: text("problem").notNull(),
  },
  (t) => [unique().on(t.name)],
);

export const agents = sqliteTable(
  "agents",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    name: text("name").notNull(),
    provider: text("provider").$type<provider>().notNull(),
    model: text("model").$type<Model>().notNull(),
    thinking: text("thinking").$type<ThinkingConfig>().notNull(),
    profile: text("profile").notNull().default("research"),
  },
  (t) => [unique().on(t.name, t.experiment)],
);

export const evolutions = sqliteTable(
  "evolutions",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated: integer("updated", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    experiment: integer("experiment")
      .notNull()
      .references(() => experiments.id),
    agent: integer("agent")
      .notNull()
      .references(() => agents.id),

    system: text("system").notNull(),
  },
  (t) => {
    return [
      index("evolutions_idx_experiment_agent_created").on(
        t.experiment,
        t.agent,
        t.created,
      ),
    ];
  },
);
