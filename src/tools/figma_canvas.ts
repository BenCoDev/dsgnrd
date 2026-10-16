import { z } from 'zod';
import type { FigmaDestination } from '../integrations/figma';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const element = z.object({
  type: z.enum(['rectangle', 'text']),
  name: z.string().min(1).max(100),
  x: z.number().min(0).max(1600), y: z.number().min(0).max(1600),
  width: z.number().min(1).max(1600), height: z.number().min(1).max(1600),
  color,
  text: z.string().max(2000).optional(),
  fontSize: z.number().min(8).max(120).optional(),
  bold: z.boolean().optional(),
  radius: z.number().min(0).max(100).optional(),
}).strict().refine(e => e.type !== 'text' || typeof e.text === 'string', 'Text layers require text.');
export const sceneSchema = z.object({
  title: z.string().min(1).max(120),
  width: z.number().int().min(100).max(1600),
  height: z.number().int().min(100).max(1600),
  background: color,
  elements: z.array(element).max(40),
}).strict().refine(s => s.elements.every(e => e.x + e.width <= s.width && e.y + e.height <= s.height), 'Keep all layers within the frame.');
export type Scene = z.infer<typeof sceneSchema>;
export type CanvasRequest = {
  action: 'list' | 'inspect' | 'create' | 'revise' | 'reconcile';
  frameId?: string; revision?: number; scene?: Scene; operation?: string;
  prepare?: boolean;
};

declare const figma: any;
// This fixed function is serialized into Plugin API code. User strings are JSON data,
// never executable code. Keep it self-contained (no closures/imports).
async function canvas(input: CanvasRequest & { destination: FigmaDestination; agent: number }) {
  const { destination: d, agent, action } = input;
  if (figma.fileKey !== d.file_key) throw new Error('Figma destination file mismatch.');
  const page = await figma.getNodeByIdAsync(d.page_id);
  if (!page || page.type !== 'PAGE') throw new Error('Configured Figma page is missing.');
  const metadata = (node: any) => {
    try { return JSON.parse(node.getPluginData('dsgnrd') || 'null'); } catch { return null; }
  };
  const areas = page.children.filter((n: any) => n.type === 'SECTION' && metadata(n)?.scope === d.scope);
  const frames = areas.flatMap((n: any) => n.children.filter((f: any) => f.type === 'FRAME' && metadata(f)?.scope === d.scope && metadata(f)?.owner === metadata(n)?.owner));
  const record = (f: any) => ({ frameId: f.id, title: f.name, owner: metadata(f).owner, revision: metadata(f).revision, phase: metadata(f).phase });
  if (action === 'list') return { proposals: frames.map(record) };
  let frame = action === 'reconcile'
    ? frames.find((f: any) => metadata(f)?.operation === input.operation)
    : frames.find((f: any) => f.id === input.frameId);
  if (action === 'reconcile') {
    if (!frame || metadata(frame).owner !== agent || metadata(frame).phase !== 'complete') throw new Error('Write outcome unresolved. No complete matching operation found; do not retry creation. Human inspection is required.');
  }
  if (action === 'inspect' && !frame) throw new Error('Frame is outside this experiment destination. Use list_proposals.');
  if (action === 'revise') {
    if (!frame || metadata(frame).owner !== agent) throw new Error('You may revise only your own proposal frames.');
    if (metadata(frame).phase !== 'complete' || metadata(frame).revision !== input.revision) throw new Error('Proposal changed. Inspect it and use the current revision.');
    if (frame.children.some((n: any) => n.getPluginData('dsgnrd-managed') !== d.scope)) throw new Error('Proposal contains unrelated layers; refusing to replace them.');
    if (frame.parent.children.length !== 1) throw new Error('Proposal area contains unrelated content.');
    if (input.scene!.width !== frame.width || input.scene!.height !== frame.height) throw new Error('Revisions preserve frame dimensions. Create a new proposal for a different size.');
  }
  if (action === 'create' || action === 'revise') {
    const scene = input.scene!;
    // Font loads and ownership checks happen before any mutation.
    if (scene.elements.some(e => e.type === 'text' && !e.bold)) await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    if (scene.elements.some(e => e.type === 'text' && e.bold)) await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
    if (input.prepare) return { prepared: true };
    const paint = (hex: string) => [{ type: 'SOLID', color: { r: parseInt(hex.slice(1,3),16)/255, g: parseInt(hex.slice(3,5),16)/255, b: parseInt(hex.slice(5,7),16)/255 } }];
    let area: any;
    if (action === 'create') {
      // One section per proposal, placed beneath all existing content. This avoids
      // expanding an older agent section into peer or unrelated content.
      const y = Math.max(160, ...page.children.map((n: any) => n.y + n.height + 160));
      area = figma.createSection(); page.appendChild(area);
      area.setPluginData('dsgnrd', JSON.stringify({ scope: d.scope, owner: agent }));
      area.name = `dsgnrd / agent ${agent} / ${scene.title}`;
      area.x = 160; area.y = y;
      frame = figma.createFrame(); area.appendChild(frame);
      frame.x = 40; frame.y = 40;
    } else {
      area = frame.parent;
      // Refuse resizing a section that now contains unrelated content.
      if (area.children.length !== 1) throw new Error('Proposal area contains unrelated content.');
      if (scene.width !== frame.width || scene.height !== frame.height) throw new Error('Revisions preserve frame dimensions. Create a new proposal for a different size.');
    }
    const revision = action === 'create' ? 1 : metadata(frame).revision + 1;
    const state = { scope: d.scope, owner: agent, revision, operation: input.operation, phase: 'pending' };
    frame.setPluginData('dsgnrd', JSON.stringify(state));
    frame.name = scene.title; frame.resize(scene.width, scene.height); frame.fills = paint(scene.background);
    if (action === 'create') area.resizeWithoutConstraints(scene.width + 80, scene.height + 80);
    for (const child of [...frame.children]) child.remove();
    for (const element of scene.elements) {
      const node = element.type === 'text' ? figma.createText() : figma.createRectangle();
      frame.appendChild(node); node.setPluginData('dsgnrd-managed', d.scope); node.name = element.name;
      if (element.type === 'text') {
        node.fontName = { family: 'Inter', style: element.bold ? 'Bold' : 'Regular' };
        node.fontSize = element.fontSize || 16; node.characters = element.text!; node.textAutoResize = 'NONE';
      } else node.cornerRadius = element.radius || 0;
      node.resize(element.width, element.height); node.x = element.x; node.y = element.y; node.fills = paint(element.color);
    }
    state.phase = 'complete'; frame.setPluginData('dsgnrd', JSON.stringify(state));
  }
  if (!frame) throw new Error('Proposal not found.');
  const png = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: Math.min(1, 1568 / Math.max(frame.width, frame.height)) } });
  return { ...record(frame), fileKey: d.file_key, pageId: page.id, operation: metadata(frame).operation,
    layers: frame.children.map((n: any) => ({ id: n.id, name: n.name, type: n.type, ...(n.type === 'TEXT' ? { text: n.characters } : {}) })),
    png: figma.base64Encode(png) };
}

export function canvasCode(destination: FigmaDestination, agent: number, request: CanvasRequest): string {
  // tsx/esbuild may add its function-name helper when serializing nested functions.
  return `const __name = (fn, name) => fn; return await (${canvas.toString()})(${JSON.stringify({ ...request, destination, agent })});`;
}
