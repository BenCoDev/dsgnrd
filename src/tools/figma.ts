import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createFigmaRemote, withFigmaLock, type FigmaRemote } from '../integrations/figma';
import { figmaStore, type FigmaStore } from '../resources/figma';
import { canvasCode, sceneSchema, type CanvasRequest, type Scene } from './figma_canvas';
import { isScreenshot } from '../lib/images';

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const nodeId = z.string().regex(/^\d+:\d+$/);

export function createFigmaServer(experiment: number, agent: number, options: {
  remote?: FigmaRemote; store?: FigmaStore; lock?: typeof withFigmaLock;
} = {}): McpServer {
  const remote = options.remote || createFigmaRemote();
  const store = options.store || figmaStore;
  const lock = options.lock || withFigmaLock;
  const server = new McpServer({ name: 'figma', version: '0.1.0' });
  const pending = new Set<Promise<CallToolResult>>();
  let stopped = false;
  async function run(action: CanvasRequest['action'], input: { operationKey?: string; frameId?: string; revision?: number; scene?: Scene } = {}): Promise<CallToolResult> {
    if (stopped) return failure('Figma tools are closed.');
    const work = (async () => {
      try {
        store.validateAgent(experiment, agent);
        const destination = store.destination(experiment);
        return await lock(destination.file_key, async () => {
          const request: CanvasRequest = { action, ...(input.frameId ? { frameId: input.frameId } : {}), ...(input.revision !== undefined ? { revision: input.revision } : {}), ...(input.scene ? { scene: input.scene } : {}) };
          if (action === 'create' || action === 'revise' || action === 'reconcile') {
            const prior = store.operation(agent, input.operationKey!);
            const serialized = JSON.stringify(request);
            if (prior && action !== 'reconcile' && prior.request !== serialized) throw new Error('Operation key already used with different input.');
            if (prior?.status === 'complete' && prior.result) return JSON.parse(prior.result) as CallToolResult;
            if (action === 'reconcile' && !prior) throw new Error('Unknown operation key.');
            if (prior && action !== 'reconcile') throw new Error(`Operation ${input.operationKey} has an uncertain outcome. Use reconcile_operation with the same key; do not create a new key to retry.`);
            if (!prior && store.pending(experiment).length) throw new Error('An unresolved write blocks this experiment. Its author must reconcile_operation before new writes.');
            if (!prior) await remote.execute(destination.file_key, canvasCode(destination, agent, { ...request, prepare: true }));
            // Durable intent precedes external effects. Never blindly retry pending intent.
            const operation = prior || store.begin(experiment, agent, input.operationKey!, serialized);
            let result: CallToolResult;
            try {
              result = normalize(await remote.execute(destination.file_key, canvasCode(destination, agent, { ...request, operation: operation.id })), destination.file_key);
            } catch (error) {
              throw new Error(`Operation ${input.operationKey} remains pending. ${error instanceof Error ? error.message : 'Figma request failed.'} Use reconcile_operation; do not retry with a new key.`);
            }
            store.finish(operation.id, JSON.stringify(result));
            return result;
          }
          return normalize(await remote.execute(destination.file_key, canvasCode(destination, agent, request)), destination.file_key);
        });
      } catch (error) { return failure(error instanceof Error ? error.message : 'Figma request failed.'); }
    })();
    pending.add(work);
    try { return await work; } finally { pending.delete(work); }
  }
  server.tool('list_proposals', 'List proposal frame IDs, owners, and revisions in this experiment. Peer proposals are readable.', {}, () => run('list'));
  server.tool('inspect_proposal', 'Inspect a proposal, including a real PNG screenshot and editable layer IDs. Saved evidence describes this inspection time.', { frameId: nodeId }, input => run('inspect', input));
  server.tool('create_proposal', 'Create an editable proposal in your own separate area. Use a new stable operationKey per intended write. Inspect the returned screenshot before publishing its frame link. Never retry an uncertain write with a new key.', { operationKey: key, scene: sceneSchema }, input => run('create', input));
  server.tool('revise_proposal', 'Replace the managed layers in your own frame, preserving its dimensions. Requires the inspected revision. Peer and unrelated layers cannot be changed. Returns a new screenshot.', { operationKey: key, frameId: nodeId, revision: z.number().int().min(1), scene: sceneSchema }, input => run('revise', input));
  server.tool('reconcile_operation', 'Read the destination to resolve your pending write without repeating it. If no complete operation can be proven, stop and request human inspection. Completed operations return their saved evidence.', { operationKey: key }, input => run('reconcile', input));
  const close = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => { stopped = true; await Promise.allSettled([...pending]); try { await remote.close(); } finally { await close(); } })();
  return server;
}
function failure(message: string): CallToolResult { return { isError: true, content: [{ type: 'text', text: message }] }; }
function normalize(raw: unknown, fileKey: string): CallToolResult {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid Figma evidence.');
  const { png, ...data } = raw as Record<string, unknown>;
  if (data.frameId && (data.fileKey !== fileKey || typeof data.frameId !== 'string')) throw new Error('Figma returned a different destination.');
  if (data.frameId && !png) throw new Error('No visual evidence was obtained.');
  const text = JSON.stringify({ ...data, ...(data.frameId ? { url: `https://www.figma.com/design/${fileKey}?node-id=${String(data.frameId).replace(':', '-')}` } : {}), inspectedAt: new Date().toISOString() });
  if (text.length > 131072) throw new Error('Figma evidence is too large.');
  const content: CallToolResult['content'] = [{ type: 'text', text }];
  if (png !== undefined) {
    if (typeof png !== 'string' || !isScreenshot(png, 'image/png')) throw new Error('Figma screenshot is invalid or exceeds the supported size.');
    content.push({ type: 'image', data: png, mimeType: 'image/png' });
  }
  return { content, isError: false };
}
