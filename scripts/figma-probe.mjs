// Standalone connection discovery only. Does not call models or mutate Figma.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

const entrypoint = process.argv[2];
if (!entrypoint || process.argv.length !== 3) {
  console.error('Usage: node scripts/figma-probe.mjs /absolute/path/to/figma-console-mcp/dist/local.js');
  process.exitCode = 1;
} else {
  await access(resolve(entrypoint));
  const client = new Client({ name: 'dsgnrd-figma-proof', version: '0.0.1' });
  // Deliberately do not forward project/model credentials to this process.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(entrypoint)],
    stderr: 'pipe',
  });
  // Consume diagnostics without printing account paths or credential-bearing errors.
  transport.stderr?.on('data', () => {});
  const deadline = setTimeout(() => {
    console.error('Figma connection probe exceeded 75 seconds.');
    process.exit(1);
  }, 75_000);
  try {
    await client.connect(transport, { timeout: 15_000 });
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: 10_000 });
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new Error('Tool discovery exceeded page limit.');
    const relevant = new Set([
      'figma_get_status', 'figma_list_open_files', 'figma_execute',
      'figma_capture_screenshot', 'figma_take_screenshot',
    ]);
    console.log(JSON.stringify({
      server: client.getServerVersion(),
      tools: tools.filter(tool => relevant.has(tool.name)),
    }, null, 2));
    if (!tools.some(tool => tool.name === 'figma_get_status')) {
      throw new Error('Expected status tool is missing.');
    }
    let connected = false;
    // The plugin periodically scans for listeners. Give it time to discover this one.
    for (let attempt = 0; attempt < 15; attempt++) {
      const status = await client.callTool({ name: 'figma_get_status', arguments: { probe: true } }, undefined, { timeout: 10_000 });
      const details = status.content.filter(item => item.type === 'text').map(item => {
        try { return JSON.parse(item.text); } catch { return null; }
      }).find(item => item?.transport);
      if (!status.isError && details?.transport?.websocket?.available) {
        connected = true;
        console.log(JSON.stringify({ status }, null, 2));
        const files = await client.callTool({ name: 'figma_list_open_files', arguments: {} }, undefined, { timeout: 10_000 });
        console.log(JSON.stringify({ files }, null, 2));
        break;
      }
      if (attempt === 14) console.log(JSON.stringify({ status }, null, 2));
      else await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!connected) {
      console.error('No Desktop Bridge connected within the discovery window.');
      process.exitCode = 1;
    }
    console.log('Discovery complete. This is not proof of create / inspect / edit capability.');
  } catch {
    console.error('Figma probe failed. Check the server installation and Desktop Bridge connection.');
    process.exitCode = 1;
  } finally {
    await client.close();
    clearTimeout(deadline);
  }
}
