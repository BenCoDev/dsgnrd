import { createHash } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { z } from 'zod';

export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const prototypeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  html: z.string().min(1).max(300_000),
  css: z.string().max(100_000),
  javascript: z.string().max(100_000),
}).strict();
export type Prototype = z.infer<typeof prototypeSchema>;
export const prototypeCSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// srcdoc inherits the parent's CSP; allow local inline code here too. The iframe's
// opaque origin, sandbox flags and stricter inner policy provide the boundary.
export const previewCSP = prototypeCSP.replace("frame-src 'none'", "frame-src 'self'") + "; frame-ancestors 'self'";

// Files are immutable content-addressed tool artifacts, not a new collaboration entity.
// Namespace by database so identical experiment IDs in different DBs never collide.
export function prototypeRoot() {
  const database = resolve(process.env.DATABASE_PATH ?? './db.sqlite');
  const namespace = createHash('sha256').update(database).digest('hex').slice(0, 16);
  return resolve(process.env.DSGNRD_PROTOTYPES_DIR ?? '.local/prototypes', namespace);
}
function safeDirectory(path: string, create = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/')) {
    current = join(current, part);
    if (!existsSync(current) && create) mkdirSync(current);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Prototype directory must not contain symlinks.');
  }
}
function folder(experiment: number, author: number) {
  for (const id of [experiment, author]) if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid experiment or author.');
  return join(prototypeRoot(), String(experiment), String(author));
}
function serialize(input: Prototype) {
  const value = prototypeSchema.parse(input);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 512_000) throw new Error('Prototype exceeds 512KB.');
  return { value, json, revision: createHash('sha256').update(json).digest('hex') };
}
export function prototypePath(experiment: number, author: number, revision: string) {
  return `/experiments/${experiment}/prototypes/${author}/${revisionSchema.parse(revision)}`;
}
export function savePrototype(experiment: number, author: number, input: Prototype) {
  const { json, revision } = serialize(input);
  const dir = folder(experiment, author);
  safeDirectory(dir, true);
  const file = join(dir, `${revision}.json`);
  if (!existsSync(file) && readdirSync(dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).length >= 100) throw new Error('Prototype revision limit reached (100 per author).');
  try { writeFileSync(file, json, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // Replays are idempotent; verify existing contents instead of trusting a filename.
  readPrototype(experiment, author, revision);
  return { author, revision, previewPath: prototypePath(experiment, author, revision), bytes: Buffer.byteLength(json) };
}
export function readPrototype(experiment: number, author: number, revision: string): Prototype {
  revisionSchema.parse(revision);
  const dir = folder(experiment, author);
  safeDirectory(dir);
  const fd = openSync(join(dir, `${revision}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 512_000) throw new Error('Invalid prototype artifact.');
    const json = readFileSync(fd, 'utf8');
    if (createHash('sha256').update(json).digest('hex') !== revision) throw new Error('Prototype artifact hash mismatch.');
    return prototypeSchema.parse(JSON.parse(json));
  } finally { closeSync(fd); }
}
export function listPrototypes(experiment: number, author: number) {
  const dir = folder(experiment, author);
  if (!existsSync(dir)) return [];
  safeDirectory(dir);
  return readdirSync(dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).slice(0, 100).map(file => {
    const revision = file.slice(0, -5);
    const prototype = readPrototype(experiment, author, revision);
    return { author, revision, title: prototype.title, previewPath: prototypePath(experiment, author, revision) };
  });
}
function escape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
export function prototypeDocument(input: Prototype) {
  // CSP is parsed before any authored HTML. Raw closing tags in CSS/JS cannot escape their blocks.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(prototypeCSP)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)}</title><style>${input.css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${input.html}<script>${input.javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
export function prototypePreview(input: Prototype) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)} — prototype</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block}body{overflow:hidden}</style></head><body><iframe title="${escape(input.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escape(prototypeDocument(input))}"></iframe></body></html>`;
}
