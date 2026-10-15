import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { MOBBIN_URL, MobbinAuth, withMobbinLock, boundedFetch, LOGIN_REQUIRED, mobbinDirectory } from '../integrations/mobbin';
import { isReferenceImage } from '../lib/images';

const names = new Set(['search_screens', 'search_flows', 'search_sections']);
export interface MobbinRemote {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

// Each request owns its connection. The account lock covers connect, refresh and request,
// including across CLI processes; no remote connection survives a completed tool call.
export function createMobbinRemote(options: { url?: URL; directory?: string; fetch?: typeof fetch } = {}): MobbinRemote {
  const directory = options.directory ?? mobbinDirectory();
  let stopped = false;
  async function request<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return withMobbinLock(async () => {
      if (stopped) throw new Error('Mobbin connection is closed.');
      const provider = await new MobbinAuth(directory).load();
      if (!provider.tokens()) throw new Error(LOGIN_REQUIRED);
      const client = new Client({ name: 'dsgnrd', version: '0.0.1' });
      const transport = new StreamableHTTPClientTransport(options.url ?? MOBBIN_URL, { authProvider: provider, fetch: options.fetch ?? boundedFetch });
      try {
        await client.connect(transport);
        return await fn(client);
      } catch { throw new Error('Mobbin request failed. Check access with mobbin login, your plan and service availability.'); }
      finally {
        try { if (transport.sessionId) await transport.terminateSession(); } catch { /* Always close local transport too. */ }
        await client.close();
      }
    }, directory);
  }
  return {
    listTools: () => request(async client => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...result.tools.filter(t => names.has(t.name)));
        cursor = result.nextCursor;
        if (!cursor) return tools;
      }
      throw new Error('Mobbin tool discovery exceeded its page limit.');
    }),
    callTool: (name, args) => request(async client => await client.callTool({ name, arguments: args }) as CallToolResult),
    close: async () => { stopped = true; },
  };
}

export function normalizeMobbinResult(result: CallToolResult): CallToolResult {
  const content: CallToolResult['content'] = [];
  let size = 0;
  for (const item of result.content) {
    if (item.type === 'image') {
      if (!isReferenceImage(item.data, item.mimeType)) throw new Error('Mobbin returned an unsupported or oversized preview.');
      size += item.data.length;
      content.push({ type: 'image', data: item.data, mimeType: item.mimeType });
    } else if (item.type === 'text') {
      if (item.text.length > 131072) throw new Error('Mobbin returned too much text. Narrow the search.');
      size += item.text.length;
      content.push({ type: 'text', text: item.text });
    } else if (item.type === 'resource_link') {
      // Keep provenance as text; remote UI resources are not executed by dsgnrd.
      const text = JSON.stringify(item);
      size += text.length;
      content.push({ type: 'text', text });
    }
  }
  if (result.structuredContent) {
    const text = JSON.stringify(result.structuredContent);
    if (text.length > 131072) throw new Error('Mobbin returned too much structured content. Narrow the search.');
    size += text.length;
    content.push({ type: 'text', text });
  }
  if (size > 8 * 1024 * 1024) throw new Error('Mobbin result is too large. Narrow the search.');
  if (!content.length) content.push({ type: 'text', text: 'Mobbin returned no supported reference content.' });
  return { content, isError: result.isError ?? false };
}

export function createMobbinServer(remote: MobbinRemote = createMobbinRemote()): McpServer {
  const server = new McpServer({ name: 'mobbin', version: '0.1.0' });
  let tools: Promise<Tool[]> | undefined;
  let stopped = false;
  const pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (stopped) return Promise.reject(new Error('Mobbin tools are closed.'));
    const promise = operation(); pending.add(promise);
    void promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }
  function discover() {
    return tools ??= remote.listTools().then(all => {
      const allowed = all.filter(t => names.has(t.name));
      if (allowed.length !== names.size || new Set(allowed.map(t => t.name)).size !== names.size) throw new Error('Mobbin search tool contract changed. Check the integration.');
      // Forward schemas/descriptions, not remote UI or execution metadata.
      return allowed.map(({ name, description, inputSchema }) => ({
        name, description,
        inputSchema: { ...inputSchema, properties: { ...inputSchema.properties,
          image_format: { type: "string", enum: ["jpg"], default: "jpg", description: "JPEG previews supported by dsgnrd." },
        } },
      }));
    }).catch(e => { tools = undefined; throw e; });
  }
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, () => track(async () => ({ tools: await discover() })));
  server.server.setRequestHandler(CallToolRequestSchema, request => track(async () => {
    try {
      if (!names.has(request.params.name)) throw new Error('Unknown Mobbin search tool.');
      await discover();
      return normalizeMobbinResult(await remote.callTool(request.params.name, { ...request.params.arguments, image_format: "jpg" }));
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Mobbin search failed or returned unsupported content. Narrow the search, or check Mobbin authorization and service availability. No visual evidence was obtained.' }] };
    }
  }));
  const close = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => {
    stopped = true;
    await Promise.allSettled([...pending]);
    try { await remote.close(); } finally { await close(); }
  })();
  return server;
}
