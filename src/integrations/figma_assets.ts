import { openSync, closeSync, fstatSync, readFileSync, readdirSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { isReferenceImage, MAX_IMAGE_BYTES } from '../lib/images';
import type { Scene, SceneElement } from '../tools/figma_canvas';

const filename = /^[a-zA-Z0-9_-]+\.(png|jpe?g)$/i;
// Imported evidence uses the same bounded image path as operator-supplied assets.
function assetDirectory(experiment?: number): string | undefined {
  return process.env.DSGNRD_FIGMA_ASSETS || (experiment === undefined ? undefined : resolve('.local/figma-assets', String(experiment)));
}
export function saveResearchAsset(data: string, mimeType: string, experiment: number) {
  if (!isReferenceImage(data, mimeType)) throw new Error('Invalid or oversized research image.');
  const bytes = Buffer.from(data, 'base64');
  const assetId = `research-${createHash('sha256').update(bytes).digest('hex')}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const dir = assetDirectory(experiment)!;
  mkdirSync(dir, { recursive: true });
  try { writeFileSync(join(dir, assetId), bytes, { flag: 'wx' }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (readFigmaAsset(assetId, experiment) !== data) throw new Error('Asset content mismatch.');
  }
  return { assetId, bytes: bytes.length, ...dimensions(data, mimeType === 'image/png') };
}
export function readFigmaAsset(id: string, experiment?: number): string {
  if (!filename.test(id)) throw new Error('Invalid asset ID.');
  const dir = assetDirectory(experiment);
  if (!dir) throw new Error('No Figma asset directory configured.');
  const fd = openSync(join(resolve(dir), id), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Asset exceeds the image limit.');
    const data = readFileSync(fd).toString('base64');
    if (!isReferenceImage(data, /\.png$/i.test(id) ? 'image/png' : 'image/jpeg')) throw new Error('Invalid image or dimensions exceed 1600px.');
    return data;
  } finally { closeSync(fd); }
}
// Called only after image validation; expose aspect ratio so agents can choose FIT/FILL honestly.
function dimensions(data: string, png: boolean): { width: number; height: number } {
  const bytes = Buffer.from(data, 'base64');
  if (png) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  let offset = 2;
  while (offset + 4 < bytes.length) {
    offset++;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    offset += length;
  }
  throw new Error('Image dimensions missing.');
}
export function listFigmaAssets(experiment?: number) {
  const dir = assetDirectory(experiment);
  if (!dir) return [];
  let files: string[];
  try { files = readdirSync(resolve(dir)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  return files.filter(id => filename.test(id)).sort().flatMap(id => {
    try { const data = readFigmaAsset(id, experiment); return [{ assetId: id, bytes: Buffer.byteLength(data, 'base64'), ...dimensions(data, /\.png$/i.test(id)) }]; }
    catch { return []; }
  });
}
export function sceneAssets(scene: Scene, experiment?: number): Record<string, string> {
  const ids = new Set<string>();
  const walk = (items: SceneElement[]) => { for (const e of items) { if (e.type === 'image' && e.assetId) ids.add(e.assetId); walk(e.children ?? []); } };
  walk(scene.elements);
  if (ids.size > 8) throw new Error('At most eight supplied images per scene.');
  const result: Record<string, string> = {}; let bytes = 0;
  for (const id of ids) {
    const data = readFigmaAsset(id, experiment); bytes += Buffer.byteLength(data, 'base64');
    if (bytes > 8 * 1024 * 1024) throw new Error('Scene images exceed 8MB.');
    result[id] = data;
  }
  return result;
}
