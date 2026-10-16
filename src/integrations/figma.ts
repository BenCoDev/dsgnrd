import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

export type FigmaDestination = { experiment: number; scope: string; file_key: string; page_id: string };
export interface FigmaRemote { execute(fileKey: string, code: string): Promise<unknown>; close(): Promise<void> }

// Process-local shared transport. All canvas requests also hold a cross-process file lock.
// The pinned external server is installed separately; agent tools never download software.
let shared: { client: Client; transport: StdioClientTransport; ready: Promise<void>; refs: number } | undefined;
export function createFigmaRemote(): FigmaRemote {
  let handle: typeof shared;
  let closed = false;
  return {
    async execute(fileKey, code) {
      if (closed) throw new Error('Figma connection is closed.');
      if (!handle) {
        if (!shared) {
          const entrypoint = process.env.DSGNRD_FIGMA_SERVER;
          if (!entrypoint || !isAbsolute(entrypoint)) throw new Error('Set DSGNRD_FIGMA_SERVER to the absolute path of figma-console-mcp 1.40.9 dist/local.js.');
          const client = new Client({ name: 'dsgnrd', version: '0.0.1' });
          const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint], stderr: 'pipe' });
          transport.stderr?.on('data', () => {});
          const ready = client.connect(transport, { timeout: 15000 }).then(() => {
            if (client.getServerVersion()?.version !== '1.40.9') throw new Error('Expected Figma Console MCP 1.40.9.');
          });
          shared = { client, transport, ready, refs: 0 };
        }
        handle = shared; handle.refs++;
      }
      await handle.ready;
      let found = false;
      for (let i = 0; i < 15; i++) {
        const status = decode(await handle.client.callTool({ name: 'figma_get_status', arguments: {} }, undefined, { timeout: 5000 }));
        if (status.transport?.websocket?.connectedFiles?.some((f: { fileKey: string }) => f.fileKey === fileKey)) { found = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!found) throw new Error('Open the configured file in Figma Desktop and run Figma Desktop Bridge.');
      const result = decode(await handle.client.callTool({ name: 'figma_execute', arguments: { fileKey, code, timeout: 20000 } }, undefined, { timeout: 25000 }));
      if (!result.success || result.error) throw new Error(String(result.error || 'Figma execution failed.'));
      return result.result;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (handle && --handle.refs === 0) {
        if (shared === handle) shared = undefined;
        await handle.client.close();
      }
    },
  };
}
function decode(value: any): any {
  if (value.isError) throw new Error('Figma MCP request failed.');
  const text = value.content?.find((item: any) => item.type === 'text')?.text;
  if (!text) throw new Error('Missing Figma response.');
  return JSON.parse(text);
}

export async function withFigmaLock<T>(fileKey: string, fn: () => Promise<T>): Promise<T> {
  const directory = process.env.DSGNRD_FIGMA_DIR || join(homedir(), '.config', 'dsgnrd', 'figma');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, `${createHash('sha256').update(fileKey).digest('hex')}.lock`);
  const until = Date.now() + 20000;
  while (true) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= until) throw new Error(`Figma file is busy. If a process crashed, confirm no dsgnrd Figma process is running before removing lock ${lock}.`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await fn(); } finally { await rmdir(lock); }
}
