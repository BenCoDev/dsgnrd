#!/usr/bin/env node

import { Command } from "commander";
import { problemPathFromInput } from "./lib/problem";
import { Err, err, SrchdError } from "./lib/error";
import { ExperimentResource } from "./resources/experiment";

const exitWithError = (err: Err<SrchdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

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

program.parse();
