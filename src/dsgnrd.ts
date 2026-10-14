#!/usr/bin/env node

import type { BasicAuthConfig } from "./server";
import { Command } from "commander";
import { problemPathFromInput } from "./lib/problem";
import { Err, err, ok, Result, DsgnrdError } from "./lib/error";
import { ExperimentResource } from "./resources/experiment";

import { getAgentProfile, listAgentProfiles } from "./agent_profile";
import { AgentResource } from "./resources/agent";
import { newID4, removeNulls } from "./lib/utils";
import { providerFromModel } from "./models/provider";
import { isThinkingConfig } from "./models";
import { isAnthropicModel } from "./models/anthropic";
import { isOpenAIModel } from "./models/openai";
import { isGeminiModel } from "./models/gemini";
import { isMistralModel } from "./models/mistral";
import { isMoonshotAIModel } from "./models/moonshotai";
import { isDeepseekModel } from "./models/deepseek";
import { isZhipuModel } from "./models/zhipu";
import { isStepfunModel } from "./models/stepfun";

import { Runner } from "./runner";
import { Advisory } from "./runner/advisory";
import { TokenUsageResource } from "./resources/token_usage";
import { readFileContent } from "./lib/fs";
const DEFAULT_REVIEWERS_COUNT = 4;

const exitWithError = (err: Err<DsgnrdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

async function experimentAndAgents({
  experiment,
  agent,
}: {
  experiment: string;
  agent?: string;
}): Promise<Result<[ExperimentResource, AgentResource[]]>> {
  const experimentRes = await ExperimentResource.findByName(experiment);
  if (experimentRes.isErr()) {
    return experimentRes;
  }
  if (!agent) {
    return ok([experimentRes.value, []]);
  }

  const agentResources: AgentResource[] = [];

  if (agent === "all") {
    agentResources.push(
      ...(await AgentResource.listByExperiment(experimentRes.value)),
    );
    return ok([experimentRes.value, agentResources]);
  }

  const agentRes = await AgentResource.findByName(experimentRes.value, agent);
  if (agentRes.isErr()) {
    return agentRes;
  }
  agentResources.push(agentRes.value);
  return ok([experimentRes.value, agentResources]);
}

const program = new Command();
program.name("dsgnrd").description("Design collaboration experiments").version("0.0.1");

// Experiment commands
const experimentCmd = program
  .command("experiment")
  .description("Manage experiments");

experimentCmd
  .command("create <name>")
  .description("Create a new experiment")
  .requiredOption(
    "-p, --problem <problem>",
    "Problem ID, relative path, or absolute path",
  )
  .action(async (name, options) => {
    console.log(`Creating experiment: ${name}`);

    // Resolve problem input to a normalized problem ID
    const problem = problemPathFromInput(options.problem);
    if (problem.isErr()) {
      return exitWithError(problem);
    }

    const experiment = await ExperimentResource.create({
      name,
      problem: problem.value,
    });

    console.table([experiment.toJSON()]);
  });

experimentCmd
  .command("list")
  .description("List all experiments")
  .action(async () => {
    const experiments = await ExperimentResource.all();

    if (experiments.length === 0) {
      return exitWithError(err("not_found_error", "No experiments found."));
    }

    console.table(experiments.map((exp) => exp.toJSON()));
  });

// Agent commands
const agentCmd = program.command("agent").description("Manage agents");

agentCmd.command("profiles").action(async () => {
  const profiles = await listAgentProfiles();
  if (profiles.isErr()) {
    return exitWithError(profiles);
  }
  for (const profile of profiles.value) {
    console.log(`${profile.name}: ${profile.description}`);
  }
});

agentCmd
  .command("create")
  .description("Create a new agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option("-n, --name <name>", "Agent name")
  .option("-m, --model <model>", "AI model", "claude-sonnet-5")
  .option(
    "-t, --thinking <thinking>",
    "Thinking configuration (none | low | high)",
    "low",
  )
  .option(
    "-c, --count <number>",
    "Number of agents to create (name used as prefix)",
    "1",
  )
  .requiredOption("-p, --profile <profile>", "Agent profile")
  .action(async (options) => {
    // Find the experiment first
    const res = await experimentAndAgents({ experiment: options.experiment });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [experiment] = res.value;

    const count = parseInt(options.count);
    if (isNaN(count) || count < 1) {
      return exitWithError(
        err("invalid_parameters_error", `Count must be a positive integer.`),
      );
    }

    const agents = [];

    for (let i = 0; i < count; i++) {
      const name =
        count > 1
          ? options.name
            ? `${options.name}-${newID4()}`
            : `${newID4()}`
          : (options.name ?? newID4());
      console.log(
        `Creating agent: ${name} for experiment: ${options.experiment}`,
      );
      const profileRes = await getAgentProfile(options.profile);
      if (profileRes.isErr()) {
        return exitWithError(profileRes);
      }
      const profile = profileRes.value;
      const model = options.model;
      const thinking = options.thinking;
      if (profile.tools.includes("computer-process")) {
        return exitWithError(err(
          "invalid_parameters_error",
          "Computer profiles are not supported in this step. Use the design profile.",
        ));
      }

      if (
        !(
          isAnthropicModel(model) ||
          isOpenAIModel(model) ||
          isGeminiModel(model) ||
          isMistralModel(model) ||
          isMoonshotAIModel(model) ||
          isDeepseekModel(model) ||
          isZhipuModel(model) ||
          isStepfunModel(model)
        )
      ) {
        return exitWithError(
          err("invalid_parameters_error", `Model '${model}' is not supported.`),
        );
      }
      const provider = providerFromModel(model);

      if (!isThinkingConfig(thinking)) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            `Thinking configuration '${thinking}' is not valid. Use 'none', 'low', or 'high'.`,
          ),
        );
      }

      const agent = await AgentResource.create(
        experiment,
        {
          name,
          model,
          provider,
          thinking,
          profile: profile.name,
        },
        { system: profile.prompt },
      );
      agents.push(agent);

    }

    console.table(
      agents.map((agent) => {
        const a = agent.toJSON();
        a.system =
          a.system.substring(0, 32) + (a.system.length > 32 ? "..." : "");
        // @ts-expect-error: replace experiment id with name for display
        a.experiment = agent.experiment.toJSON().name;
        // @ts-expect-error: replace profile object with name for display
        a.profile = a.profile.name;
        return a;
      }),
    );
  });

agentCmd
  .command("list")
  .description("List agents for a given experiment")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .action(async (options) => {
    // Find the experiment first
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: "all",
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [_experiment, agents] = res.value;

    if (agents.length === 0) {
      return exitWithError(err("not_found_error", "No agents found."));
    }

    console.table(
      agents.map((agent) => {
        const a = agent.toJSON();
        a.system =
          a.system.substring(0, 32) + (a.system.length > 32 ? "..." : "");
        // @ts-expect-error: replace experiment id with name for display
        a.experiment = agent.experiment.toJSON().name;
        // @ts-expect-error: replace profile object with name for display
        a.profile = a.profile.name;
        return a;
      }),
    );
  });

agentCmd
  .command("run <name>")
  .description("Run an agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option(
    "-r, --reviewers <reviewers>",
    "Number of required reviewers for each publication",
    DEFAULT_REVIEWERS_COUNT.toString(),
  )
  .option("-t, --tick", "Run one tick only")
  .option("--max-tokens <tokens>", "Max tokens (in millions) before stopping run")
  .option("--max-cost <cost>", "Max cost (in dollars) before stopping run")
  .action(async (name, options) => {
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: name,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [experiment, agents] = res.value;
    Advisory.register(agents.map(a => a.toJSON().name));

    let reviewers = DEFAULT_REVIEWERS_COUNT;
    if (options.reviewers) {
      reviewers = parseInt(options.reviewers);
      if (isNaN(reviewers) || reviewers < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Reviewers must be a valid integer greater than 0",
          ),
        );
      }
    }

    if (agents.length === 0) return exitWithError(err("not_found_error", "No agents found."));

    let maxTokens: number | undefined;
    let maxCost: number | undefined;

    if (options.maxTokens) {
      maxTokens = parseInt(options.maxTokens);
      if (isNaN(maxTokens) || maxTokens < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Max tokens must be a valid integer greater than 0",
          ),
        );
      }
      maxTokens *= 1_000_000; // convert to millions
    }

    if (options.maxCost) {
      maxCost = parseFloat(options.maxCost);
      if (isNaN(maxCost) || maxCost < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Max cost must be a valid number greater than 0",
          ),
        );
      }
    }

    const builders = await Promise.all(
      agents.map((a) =>
        Runner.builder(experiment, a, {
          reviewers,
        }),
      ),
    );
    const runners = removeNulls(builders.map((res) => res.isOk() ? res.value : null));
    let stopping = false;
    let runError: Err<DsgnrdError> | undefined;
    const cleanup = () => Promise.all(runners.map((r) => r.close()));
    // A handled signal closes remote resources before exiting; TTL covers hard kills.
    const onSignal = () => {
      stopping = true;
      void cleanup().finally(() => process.exit(130));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      const failed = builders.find((res) => res.isErr());
      if (failed?.isErr()) throw failed;
      if (options.tick) {
        const results = await Promise.allSettled(runners.map((r) => r.tick()));
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          if (result.value.isErr()) throw result.value;
        }
      } else {
        // Preserve upstream independent loops and periodic experiment-wide limits.
        const shouldCheck = (count: number, last: number, max: number) =>
          last / max < 0.95 ? count % 20 === 0 : true;
        let tickCount = 0;
        let lastCost = await TokenUsageResource.experimentCost(experiment);
        let lastTokens = (await TokenUsageResource.experimentTokenUsage(experiment)).total;
        const loops = runners.map(async (runner) => {
          try {
            while (!stopping) {
              if (maxCost && shouldCheck(tickCount, lastCost, maxCost)) {
                lastCost = await TokenUsageResource.experimentCost(experiment);
                if (lastCost > maxCost) {
                  console.log(`Cost exceeded: ${lastCost.toFixed(2)}`);
                  stopping = true;
                  return;
                }
              }
              if (maxTokens && shouldCheck(tickCount, lastTokens, maxTokens)) {
                lastTokens = (await TokenUsageResource.experimentTokenUsage(experiment)).total;
                if (lastTokens > maxTokens) {
                  console.log(`Tokens exceeded: ${lastTokens.toFixed(2)}`);
                  stopping = true;
                  return;
                }
              }
              if (stopping) return;
              const tick = await runner.tick();
              tickCount++;
              if (tick.isErr()) throw tick;
            }
          } catch (error) {
            stopping = true;
            throw error;
          }
        });
        // Let in-flight ticks save their exchanges before closing their tool servers.
        const results = await Promise.allSettled(loops);
        const failedLoop = results.find((r) => r.status === "rejected");
        if (failedLoop?.status === "rejected") throw failedLoop.reason;
      }
    } catch (error) {
      runError = error instanceof Err ? error : err("tool_error", "Run failed", error);
    } finally {
      stopping = true;
      await cleanup();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
    if (runError) return exitWithError(runError);
  });

agentCmd
  .command("instructions <name>")
  .description("Append a saved instruction evolution from a file")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .requiredOption("-f, --file <file>", "Instruction file")
  .action(async (name, options) => {
    const res = await experimentAndAgents({ experiment: options.experiment, agent: name });
    if (res.isErr()) return exitWithError(res);
    const content = await readFileContent(options.file);
    if (content.isErr()) return exitWithError(content);
    for (const agent of res.value[1]) {
      const updated = await agent.evolve({ system: content.value });
      if (updated.isErr()) return exitWithError(updated);
      console.log(`Saved new instructions for ${agent.toJSON().name}`);
    }
  });

program
  .command("serve")
  .description("Start the web UI server")
  .option("-p, --port <port>", "Port to serve on", "1337")
  .option("-a, --auth <user:password>", "Require HTTP basic auth credentials")
  .action(async (options) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return exitWithError(
        err(
          "invalid_parameters_error",
          "Port must be a valid number between 1 and 65535",
        ),
      );
    }

    let authConfig: BasicAuthConfig | undefined;
    if (options.auth) {
      const separator = String(options.auth).indexOf(":");
      if (separator === -1) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Auth must be provided as user:password",
          ),
        );
      }
      const username = options.auth.slice(0, separator);
      const password = options.auth.slice(separator + 1);
      if (!username || !password) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Auth must include both user and password",
          ),
        );
      }
      authConfig = { username, password };
    }

    console.log(`Starting server on http://localhost:${port}`);
    if (authConfig) {
      console.log(`Basic auth enabled for user '${authConfig.username}'`);
    }

    const { createApp } = await import("./server");
    const { serve } = await import("@hono/node-server");
    const app = createApp(authConfig);

    serve({
      fetch: app.fetch,
      port,
      hostname: "127.0.0.1",
    });
  });


program.parseAsync().catch((cause) => exitWithError(err("invalid_parameters_error", "Command failed", cause)));
