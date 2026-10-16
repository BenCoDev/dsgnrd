import { z } from 'zod';
import type { FigmaDestination } from '../integrations/figma';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export type SceneElement = {
  type: 'rectangle' | 'text' | 'image' | 'frame' | 'component' | 'instance';
  name: string; x: number; y: number; width: number; height: number; color: string;
  text?: string; fontSize?: number; bold?: boolean; weight?: 'Regular' | 'Medium' | 'Semi Bold' | 'Bold';
  lineHeight?: number; letterSpacing?: number; radius?: number; opacity?: number;
  assetId?: string; imageFit?: 'FIT' | 'FILL'; componentKey?: string; paintStyle?: string;
  layout?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'; padding?: number; gap?: number;
  fillWidth?: boolean; fillHeight?: boolean; children?: SceneElement[];
};
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
function elementSchema(depth: number): z.ZodType<SceneElement> {
  return z.object({
    type: z.enum(['rectangle', 'text', 'image', 'frame', 'component', 'instance']),
    name: z.string().min(1).max(100),
    x: z.number().min(0).max(1600), y: z.number().min(0).max(1600),
    width: z.number().min(1).max(1600), height: z.number().min(1).max(1600), color,
    text: z.string().max(2000).optional(), fontSize: z.number().min(8).max(120).optional(), bold: z.boolean().optional(),
    weight: z.enum(['Regular', 'Medium', 'Semi Bold', 'Bold']).optional(),
    lineHeight: z.number().min(8).max(180).optional(), letterSpacing: z.number().min(-5).max(30).optional(),
    radius: z.number().min(0).max(100).optional(), opacity: z.number().min(0).max(1).optional(),
    assetId: z.string().regex(/^[a-zA-Z0-9_-]+\.(png|jpe?g)$/i).optional(), imageFit: z.enum(['FIT', 'FILL']).optional(),
    componentKey: identifier.optional(), paintStyle: identifier.optional(),
    layout: z.enum(['HORIZONTAL', 'VERTICAL', 'NONE']).optional(), padding: z.number().min(0).max(200).optional(), gap: z.number().min(0).max(200).optional(),
    fillWidth: z.boolean().optional(), fillHeight: z.boolean().optional(),
    children: depth ? z.array(elementSchema(depth - 1)).max(120).optional() : z.array(z.never()).max(0).optional(),
  }).strict();
}
export const sceneSchema = z.object({
  title: z.string().min(1).max(120), width: z.number().int().min(100).max(1600), height: z.number().int().min(100).max(1600),
  background: color, elements: z.array(elementSchema(3)).max(120),
  paintStyles: z.array(z.object({ key: identifier, color }).strict()).max(20).optional(),
}).strict().superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const styles = new Set(s.paintStyles?.map(p => p.key));
  if (styles.size !== (s.paintStyles?.length ?? 0)) fail('Paint style keys must be unique.');
  const components = new Map<string, number>(); let count = 0;
  function walk(elements: SceneElement[], width: number, height: number, layout?: string): number {
    let size = 0;
    for (const e of elements) {
      count++; size++;
      if (!layout && (e.x + e.width > width || e.y + e.height > height)) fail(`Layer "${e.name}" exceeds its ${width}×${height} parent; keep x + width and y + height within bounds.`);
      if (!layout && (e.fillWidth || e.fillHeight)) fail('Fill sizing requires an auto-layout parent.');
      if (e.type === 'text' && e.text === undefined) fail('Text layers require text.');
      if (e.type === 'image' && !e.assetId) fail('Image layers require a supplied assetId.');
      if (e.paintStyle && !styles.has(e.paintStyle)) fail('Unknown paint style.');
      const container = e.type === 'frame' || e.type === 'component';
      if (!container && (e.children?.length || e.layout)) fail('Only frames/components accept children or layout.');
      if (e.type === 'instance') {
        if (!e.componentKey || !components.has(e.componentKey)) fail(`Instance "${e.name}" requires componentKey "${e.componentKey ?? ''}" to be defined earlier in this scene; move its component definition before this instance.`);
        size += components.get(e.componentKey ?? '') ?? 0;
      }
      const descendants = walk(e.children ?? [], e.width, e.height, e.layout === 'NONE' ? undefined : e.layout); size += descendants;
      if (e.type === 'component') {
        if (!e.componentKey || components.has(e.componentKey)) fail('Components require a unique componentKey.');
        else components.set(e.componentKey, descendants);
      }
    }
    return size;
  }
  if (walk(s.elements, s.width, s.height) > 300 || count > 120) fail('Scene exceeds 120 declared or 300 expanded layers.');
});
export type Scene = z.infer<typeof sceneSchema>;
export type CanvasRequest = {
  action: 'list' | 'inspect' | 'create' | 'revise' | 'reconcile';
  frameId?: string; revision?: number; scene?: Scene; operation?: string;
  prepare?: boolean; assets?: Record<string, string>;
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
  const record = (f: any) => ({ frameId: f.id, title: f.name, width: f.width, height: f.height, owner: metadata(f).owner, revision: metadata(f).revision, phase: metadata(f).phase });
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
    const unrelated = (n: any): boolean => n.getPluginData('dsgnrd-managed') !== d.scope || (n.children ?? []).some(unrelated);
    if (frame.children.some(unrelated)) throw new Error('Proposal contains unrelated layers; refusing to replace them.');
    if (frame.parent.children.length !== 1) throw new Error('Proposal area contains unrelated content.');
    if (input.scene!.width !== frame.width || input.scene!.height !== frame.height) throw new Error('Revisions preserve frame dimensions. Create a new proposal for a different size.');
  }
  if (action === 'create' || action === 'revise') {
    const scene = input.scene!;
    const flattened = (items: SceneElement[]): SceneElement[] => items.flatMap(e => [e, ...flattened(e.children ?? [])]);
    const all = flattened(scene.elements);
    const weights = new Set(all.filter(e => e.type === 'text').map(e => e.weight || (e.bold ? 'Bold' : 'Regular')));
    for (const style of weights) await figma.loadFontAsync({ family: 'Inter', style });
    for (const e of all) if (e.type === 'image' && !input.assets?.[e.assetId!]) throw new Error('Missing supplied image asset.');
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
    const styleIds = new Map<string, string>();
    const existingStyles = scene.paintStyles?.length ? await figma.getLocalPaintStylesAsync() : [];
    for (const style of scene.paintStyles ?? []) {
      // Color in the name makes styles immutable across proposal revisions.
      const name = `dsgnrd/${d.scope}/${agent}/${style.key}/${style.color}`;
      let saved = existingStyles.find((p: any) => p.name === name);
      if (!saved) { saved = figma.createPaintStyle(); saved.name = name; saved.paints = paint(style.color); }
      styleIds.set(style.key, saved.id);
    }
    const components = new Map<string, any>();
    const images = new Map<string, string>();
    async function add(element: SceneElement, parent: any) {
      const node = element.type === 'text' ? figma.createText()
        : element.type === 'frame' ? figma.createFrame()
        : element.type === 'component' ? figma.createComponent()
        : element.type === 'instance' ? components.get(element.componentKey!).createInstance()
        : figma.createRectangle();
      parent.appendChild(node);
      const mark = (n: any) => { n.setPluginData('dsgnrd-managed', d.scope); for (const child of n.children ?? []) mark(child); };
      mark(node); node.name = element.name;
      if (element.type === 'component' || element.type === 'instance') node.setPluginData('dsgnrd-component', element.componentKey!);
      if (element.type === 'text') {
        node.fontName = { family: 'Inter', style: element.weight || (element.bold ? 'Bold' : 'Regular') };
        node.fontSize = element.fontSize || 16; node.characters = element.text!; node.textAutoResize = 'NONE';
        if (element.lineHeight) node.lineHeight = { unit: 'PIXELS', value: element.lineHeight };
        if (element.letterSpacing !== undefined) node.letterSpacing = { unit: 'PIXELS', value: element.letterSpacing };
      } else if (element.type !== 'instance') node.cornerRadius = element.radius || 0;
      node.resize(element.width, element.height); node.x = element.x; node.y = element.y;
      if (element.type !== 'instance') node.fills = paint(element.color);
      if (element.type === 'image') {
        node.setPluginData('dsgnrd-asset', element.assetId!);
        if (!images.has(element.assetId!)) images.set(element.assetId!, figma.createImage(figma.base64Decode(input.assets![element.assetId!])).hash);
        node.fills = [{ type: 'IMAGE', imageHash: images.get(element.assetId!), scaleMode: element.imageFit || 'FIT' }];
      } else if (element.paintStyle && element.type !== 'instance') await node.setFillStyleIdAsync(styleIds.get(element.paintStyle));
      node.opacity = element.opacity ?? 1;
      if (element.type === 'frame' || element.type === 'component') {
        node.clipsContent = true;
        if (element.layout && element.layout !== 'NONE') {
          node.layoutMode = element.layout; node.primaryAxisSizingMode = 'FIXED'; node.counterAxisSizingMode = 'FIXED';
          node.paddingTop = node.paddingBottom = node.paddingLeft = node.paddingRight = element.padding ?? 0;
          node.itemSpacing = element.gap ?? 0;
          node.resize(element.width, element.height);
        }
        for (const child of element.children ?? []) await add(child, node);
        if (element.type === 'component') components.set(element.componentKey!, node);
      }
      if (element.fillWidth) node.layoutSizingHorizontal = 'FILL';
      if (element.fillHeight) node.layoutSizingVertical = 'FILL';
    }
    for (const element of scene.elements) await add(element, frame);
    state.phase = 'complete'; frame.setPluginData('dsgnrd', JSON.stringify(state));
  }
  if (!frame) throw new Error('Proposal not found.');
  const layerInfo = (nodes: any[]): any[] => nodes.map(n => ({
    id: n.id, name: n.name, type: n.type, x: n.x, y: n.y, width: n.width, height: n.height,
    ...(n.layoutMode ? { layout: n.layoutMode } : {}),
    ...(n.getPluginData('dsgnrd-component') ? { componentKey: n.getPluginData('dsgnrd-component') } : {}),
    ...(n.type === 'TEXT' ? { text: n.characters, fontSize: n.fontSize, fontName: n.fontName, lineHeight: n.lineHeight } : {}),
    ...(Array.isArray(n.fills) && n.fills.some((p: any) => p.type === 'IMAGE') ? {
      imageFit: n.fills.find((p: any) => p.type === 'IMAGE').scaleMode,
      assetId: n.getPluginData('dsgnrd-asset') || undefined,
    } : {}),
    ...(n.children?.length ? { children: layerInfo(n.children) } : {}),
  }));
  const png = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: Math.min(1, 1568 / Math.max(frame.width, frame.height)) } });
  return { ...record(frame), fileKey: d.file_key, pageId: page.id, operation: metadata(frame).operation,
    layers: layerInfo(frame.children),
    png: figma.base64Encode(png) };
}

export function canvasCode(destination: FigmaDestination, agent: number, request: CanvasRequest): string {
  // tsx/esbuild may add its function-name helper when serializing nested functions.
  return `const __name = (fn, name) => fn; return await (${canvas.toString()})(${JSON.stringify({ ...request, destination, agent })});`;
}
