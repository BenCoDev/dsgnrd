import { createMobbinServer } from "../../src/tools/mobbin";
import mobbinTools from "./mobbin-tools.json";
// A new process with a deterministic model, exercising the real runner and MCP tools.
import { LLM, Message, Tool, TokenUsage } from "../../src/models";
import { ok } from "../../src/lib/error";
import { ExperimentResource } from "../../src/resources/experiment";
import { AgentResource } from "../../src/resources/agent";
import { Runner } from "../../src/runner";
import { Advisory } from "../../src/runner/advisory";
import { createClientServerPair } from "../../src/lib/mcp";
import { createWebServer } from "../../src/tools/web";
import { createServer } from "../../src/tools";
import { DEFAULT_TOOLS } from "../../src/tools/constants";
import { writeFileSync } from "node:fs";
class FixtureModel extends LLM {
  private calls = 0;
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
      this.calls === 0 ? process.env.CAPTURE! : `${process.env.CAPTURE}.${this.calls}`,
      JSON.stringify({ messages, prompt, tools }),
    );
    return ok({
      message: (process.env.RESPONSES
        ? JSON.parse(process.env.RESPONSES)[this.calls++]
        : JSON.parse(process.env.RESPONSE!)) as Message,
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
  if (process.env.NO_OPTIONAL_TOOLS) a.value.toJSON().profile.tools = [];
  Advisory.register([a.value.toJSON().name]);
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];
  const clients = await Promise.all(
    [...a.value.toJSON().profile.tools, ...DEFAULT_TOOLS].map(async (tool) => {
      const server = tool === "mobbin" ? createMobbinServer({
        listTools: async () => mobbinTools as any,
        callTool: async () => ({ content: [{type:"text",text:"Reference https://mobbin.com/screens/test"},{type:"image",mimeType:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII="}] }),
        close: async () => {},
      }) : tool === "web" && process.env.WEB_FIXTURE ? createWebServer({
        browser: async () => ({success:true,id:"fake-browser"}),
        browserExecute: async () => ({success:true,stdout:JSON.stringify({url:"https://example.com",text:"Observed page",image:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII="})}),
        deleteBrowser: async () => ({success:true}),
      }) : await createServer(tool, {
        experiment: e.value,
        agent: a.value,
        config: { reviewers: Number(process.env.REVIEWERS ?? 0) },
      });
      servers.push(server);
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
    const count = process.env.RESPONSES ? JSON.parse(process.env.RESPONSES).length : 1;
    for (let i = 0; i < count; i++) {
      const result = await r.value.tick();
      if (result.isErr()) throw result.error;
    }
  } finally {
    await Promise.all(servers.map((s) => s.close()));
    await Promise.all(clients.map((c) => c.close()));
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
