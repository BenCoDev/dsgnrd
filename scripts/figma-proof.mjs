// Bounded, deterministic smoke test in Ben's designated test file only.
// Not exposed to agents. No model calls or automatic write retries.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [entrypoint, phase] = process.argv.slice(2);
if (!entrypoint || !['inspect', 'create', 'edit', 'check'].includes(phase)) {
  throw new Error('Usage: node scripts/figma-proof.mjs SERVER_ENTRYPOINT inspect|create|edit|check');
}
const fileKey = 'VEo8vKvbwyh7YiEnXbGkAj';
const marker = 'dsgnrd-connection-proof-2026-10-16';
const output = resolve('docs/figma-proof');
const client = new Client({ name: 'dsgnrd-figma-proof', version: '0.0.1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(entrypoint)], stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const deadline = setTimeout(() => { console.error('Proof timed out. Inspect destination before any retry.'); process.exit(1); }, 90_000);
function readText(result) {
  if (result.isError) throw new Error('MCP operation failed. Inspect destination before retrying.');
  const text = result.content.find(item => item.type === 'text');
  if (!text) throw new Error('Missing tool result.');
  return JSON.parse(text.text);
}
async function execute(code) {
  const result = readText(await client.callTool({ name: 'figma_execute', arguments: {
    fileKey, timeout: 15000,
    code: `if (figma.fileKey !== ${JSON.stringify(fileKey)}) throw new Error('Wrong file');\n${code}`,
  } }, undefined, { timeout: 20000 }));
  if (!result.success || result.error) throw new Error(JSON.stringify(result));
  if (result.resultAnalysis?.warning) console.error(result.resultAnalysis.warning);
  return result.result;
}
try {
  await client.connect(transport, { timeout: 15000 });
  let ready = false;
  for (let i = 0; i < 20; i++) {
    const status = readText(await client.callTool({ name: 'figma_get_status', arguments: { probe: true } }, undefined, { timeout: 10000 }));
    if (status.setup?.probeResult?.success && status.transport?.websocket?.connectedFiles?.some(file => file.fileKey === fileKey)) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!ready) throw new Error('Test file bridge is not connected.');
  await mkdir(output, { recursive: true });
  const prelude = `const page = await figma.getNodeByIdAsync('0:1');
if (!page || page.type !== 'PAGE') throw new Error('Test page missing');
const existing = page.children.filter(n => n.getPluginData('dsgnrd-proof') === ${JSON.stringify(marker)});
if (existing.length > 1) throw new Error('Ambiguous proof area');`;
  if (phase === 'inspect') {
    const result = await execute(`${prelude}
return { fileKey: figma.fileKey, page: { id: page.id, name: page.name }, nodes: page.children.map(n => ({ id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height })), proofAreas: existing.map(n => n.id) };`);
    await writeFile(`${output}/inspect.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } else {
    const mutation = phase === 'create' ? `
if (existing.length) throw new Error('Proof already exists; inspect it instead of recreating');
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const y = Math.max(160, ...page.children.map(n => n.y + n.height + 160));
const area = figma.createSection(); page.appendChild(area);
area.setPluginData('dsgnrd-proof', ${JSON.stringify(marker)});
area.name = 'dsgnrd / connection proof'; area.x = 160; area.y = y; area.resizeWithoutConstraints(480, 280);
const frame = figma.createFrame(); area.appendChild(frame); frame.name = 'Editable proposal'; frame.x = 40; frame.y = 40; frame.resize(400, 180);
frame.fills = [{type:'SOLID',color:{r:0.94,g:0.96,b:1}}]; frame.cornerRadius = 16;
const label = figma.createText(); frame.appendChild(label); label.name = 'Status'; label.fontName = { family:'Inter', style:'Regular' }; label.fontSize = 24; label.characters = 'Created by dsgnrd'; label.x = 32; label.y = 64;
` : `
if (existing.length !== 1) throw new Error('Proof area missing');
const area = existing[0];
if (area.type !== 'SECTION' || area.children.length !== 1) throw new Error('Unexpected proof structure');
const frame = area.children[0];
if (frame.type !== 'FRAME' || frame.children.length !== 1) throw new Error('Unexpected proposal structure');
const label = frame.children[0];
if (label.type !== 'TEXT' || label.name !== 'Status') throw new Error('Unexpected text layer');
${phase === 'edit' ? `await figma.loadFontAsync(label.fontName); label.characters = 'Revised by dsgnrd'; frame.fills = [{type:'SOLID',color:{r:0.88,g:0.97,b:0.92}}];` : ''}
`;
    const result = await execute(`${prelude}
${mutation}
const bytes = await frame.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});
return { fileKey: figma.fileKey, pageId: page.id, areaId: area.id, frameId: frame.id, textId: label.id, text: label.characters, frameType: frame.type, textType: label.type, png: figma.base64Encode(bytes) };`);
    const { png, ...evidence } = result;
    evidence.url = `https://www.figma.com/design/${fileKey}?node-id=${result.frameId.replace(':', '-')}`;
    evidence.inspectedAt = new Date().toISOString();
    await writeFile(`${output}/${phase}.png`, Buffer.from(png, 'base64'));
    await writeFile(`${output}/${phase}.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
} finally {
  await client.close();
  clearTimeout(deadline);
}
