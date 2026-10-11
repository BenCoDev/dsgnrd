// A new process with a deterministic model, exercising the real runner and MCP tools.
import { LLM, Message, Tool, TokenUsage } from "../../src/models";
import { ok } from "../../src/lib/error";
import { ExperimentResource } from "../../src/resources/experiment";
import { AgentResource } from "../../src/resources/agent";
import { Runner } from "../../src/runner";
import { Advisory } from "../../src/runner/advisory";
import { createClientServerPair } from "../../src/lib/mcp";
import { createServer } from "../../src/tools";
import { DEFAULT_TOOLS } from "../../src/tools/constants";
import { writeFileSync } from "node:fs";
class FixtureModel extends LLM {
  constructor() {
    super({});
  }
  async tokens() {
    return ok(10);
  }
  maxTokens() {
    return 10000;
  }
  protected costPerTokenUsage(_usage: TokenUsage) {
    return 0;
  }
  async run(
    messages: Message[],
    prompt: string,
    _choice: unknown,
    tools: Tool[],
  ) {
    writeFileSync(
      process.env.CAPTURE!,
      JSON.stringify({ messages, prompt, tools }),
    );
    return ok({
      message: JSON.parse(process.env.RESPONSE!) as Message,
      ...(process.env.NO_USAGE
        ? {}
        : {
            tokenUsage: {
              total: 15,
              input: 10,
              output: 5,
              cached: 0,
              thinking: 0,
            },
          }),
    });
  }
}
async function main() {
  const e = await ExperimentResource.findByName("test");
  if (e.isErr()) throw e.error;
  const a = await AgentResource.findByName(
    e.value,
    process.env.AGENT ?? "author",
  );
  if (a.isErr()) throw a.error;
  Advisory.register([a.value.toJSON().name]);
  const clients = await Promise.all(
    DEFAULT_TOOLS.map(async (tool) => {
      const server = await createServer(tool, {
        experiment: e.value,
        agent: a.value,
        config: { reviewers: Number(process.env.REVIEWERS ?? 0) },
      });
      return (await createClientServerPair(server))[0];
    }),
  );
  try {
    const r = await Runner.initialize(
      e.value,
      a.value,
      clients,
      new FixtureModel(),
    );
    if (r.isErr()) throw r.error;
    const result = await r.value.tick();
    if (result.isErr()) throw result.error;
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
