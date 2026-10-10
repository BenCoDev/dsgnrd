import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicLLM } from "../src/models/anthropic";
import { createLLM } from "../src/models/provider";
import type { Message, Tool } from "../src/models";

test("Anthropic request conversion, token count, usage and authentication failure without network", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-only-not-a-real-key";
  const requests: { url: string; body: any }[] = [];
  let fail = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.json() });
    if (fail)
      return Response.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "Invalid credentials",
          },
        },
        { status: 401 },
      );
    if (request.url.includes("count_tokens"))
      return Response.json({ input_tokens: 123 });
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        { type: "text", text: "Checking proposals" },
        {
          type: "tool_use",
          id: "call_new",
          name: "publications-list_publications",
          input: {},
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 3,
        cache_creation: {
          ephemeral_1h_input_tokens: 2,
          ephemeral_5m_input_tokens: 1,
        },
      },
    });
  };
  try {
    const model = createLLM("claude-haiku-4-5", { thinking: "none" });
    assert.ok(model instanceof AnthropicLLM);
    const history: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Brief", provider: null }],
      },
      {
        role: "agent",
        content: [
          {
            type: "tool_use",
            id: "call_old",
            name: "publications-list_publications",
            input: {},
            provider: null,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "call_old",
            toolUseName: "publications-list_publications",
            content: [{ type: "text", text: "No publications" }],
            isError: false,
          },
        ],
      },
    ];
    const tools: Tool[] = [
      {
        name: "publications-list_publications",
        description: "List work",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const count = await model.tokens(
      history,
      "Design instructions",
      "auto",
      tools,
    );
    assert.ok(count.isOk());
    assert.equal(count.value, 123);
    const response = await model.run(
      history,
      "Design instructions",
      "auto",
      tools,
    );
    assert.ok(response.isOk());
    assert.equal(response.value.message.role, "agent");
    assert.equal(response.value.message.content[1].type, "tool_use");
    assert.deepEqual(response.value.tokenUsage, {
      total: 21,
      input: 16,
      output: 5,
      cached: 3,
      thinking: 0,
    });
    const body = requests[1].body;
    assert.equal(body.model, "claude-haiku-4-5");
    assert.equal(body.messages[1].role, "assistant");
    assert.equal(body.messages[2].content[0].tool_use_id, "call_old");
    assert.equal(body.system[0].text, "Design instructions");
    assert.equal(body.tools[0].input_schema.type, "object");
    assert.deepEqual(body.tool_choice, { type: "auto" });
    fail = true;
    const failure = await model.tokens(
      history,
      "Design instructions",
      "auto",
      tools,
    );
    assert.ok(failure.isErr());
    assert.equal(failure.error.code, "model_error");
    assert.match(failure.error.cause?.message ?? "", /Invalid credentials/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
