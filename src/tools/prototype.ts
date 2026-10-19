import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { agents } from '../db/schema';
import { listPrototypes, prototypePath, prototypeSchema, readPrototype, revisionSchema, savePrototype } from '../integrations/prototype';
import { actionSchema, LocalPrototypeBrowser, viewportSchema, type PrototypeBrowser, type Observation } from '../integrations/prototype_browser';

export function validatePrototypeAgent(experiment: number, author: number) {
  if (!db.select({ id: agents.id }).from(agents).where(and(eq(agents.id, author), eq(agents.experiment, experiment))).get()) throw new Error('Agent does not belong to this experiment.');
}
export function createPrototypeServer(experiment: number, agent: number, options: { browser?: PrototypeBrowser; readOnly?: boolean } = {}) {
  const server = new McpServer({ name: 'prototype', version: '0.1.0' });
  const browser = options.browser ?? new LocalPrototypeBrowser();
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const observation = ({ png, ...metadata }: Observation): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(metadata) }, { type: 'image', mimeType: 'image/png', data: png }] });
  function run(work: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
    // Serialize shared browser state: simultaneous actions cannot consume the same observation.
    const result = queue.then(async () => {
      try {
        if (stopped) throw new Error('Prototype tools are closed.');
        validatePrototypeAgent(experiment, agent);
        return await work();
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Prototype operation failed.' }] } as CallToolResult; }
    });
    queue = result;
    return result;
  }
  if (!options.readOnly) {
    server.tool('save', 'Save HTML body markup, CSS and browser JavaScript as an immutable prototype revision owned by you. No shell, build step, external dependencies or network requests. Use inline SVG, system fonts or data URLs for assets. Returns a stable previewPath; inspect before publishing.', prototypeSchema.shape, input => run(() => text(savePrototype(experiment, agent, input))));
    server.tool('edit', 'Replace exactly one occurrence in one source file of your own saved revision. Returns a new immutable revision. The old revision remains available to reviewers.', {
      revision: revisionSchema, file: z.enum(['html', 'css', 'javascript']), oldText: z.string().min(1).max(100_000), newText: z.string().max(100_000),
    }, input => run(() => {
      const source = readPrototype(experiment, agent, input.revision);
      const original = source[input.file];
      const index = original.indexOf(input.oldText);
      if (index < 0 || original.indexOf(input.oldText, index + 1) >= 0) throw new Error('oldText must match exactly once; read the file and use a more specific replacement.');
      source[input.file] = original.slice(0, index) + input.newText + original.slice(index + input.oldText.length);
      return text(savePrototype(experiment, agent, source));
    }));
  }
  server.tool('list', 'List saved prototype revisions by you or a peer in this experiment. Revisions are immutable; choose the exact revision cited in a publication.', { author: z.number().int().positive().optional() }, input => run(() => {
    const author = input.author ?? agent; validatePrototypeAgent(experiment, author);
    return text(listPrototypes(experiment, author));
  }));
  server.tool('read', 'Read a bounded source-file excerpt from an exact prototype revision in this experiment. Follow nextOffset until null to read the complete file.', {
    author: z.number().int().positive().optional(), revision: revisionSchema, file: z.enum(['html', 'css', 'javascript']), offset: z.number().int().min(0).default(0),
  }, input => run(() => {
    const author = input.author ?? agent; validatePrototypeAgent(experiment, author);
    const source = readPrototype(experiment, author, input.revision), content = source[input.file];
    if (input.offset > content.length) throw new Error('Offset exceeds file length.');
    const end = Math.min(input.offset + 18000, content.length);
    return text({ author, revision: input.revision, title: source.title, file: input.file, content: content.slice(input.offset, end), nextOffset: end < content.length ? end : null });
  }));
  server.tool('inspect', 'Open an exact saved revision in an isolated local Chromium browser, resetting interaction state. Returns a real PNG, visible text, controls, overflow and JavaScript errors. Browser must be installed with npx playwright install chromium. Publish the returned previewPath and revision with tested states.', {
    author: z.number().int().positive().optional(), revision: revisionSchema,
    viewport: viewportSchema.default({ width: 390, height: 844 }), reducedMotion: z.boolean().default(false),
  }, input => run(async () => {
    const author = input.author ?? agent; validatePrototypeAgent(experiment, author);
    return observation(await browser.open(readPrototype(experiment, author, input.revision), { author, revision: input.revision, previewPath: prototypePath(experiment, author, input.revision) }, input.viewport, input.reducedMotion));
  }));
  server.tool('act', 'Test an interaction in your current inspection session and return a new screenshot. Use the latest session/observation. Selectors refer to prototype elements only. A failed action closes the session; inspect again rather than blindly replaying. Maximum 40 actions / 10 minutes per inspection.', {
    session: z.string().uuid(), observation: z.number().int().positive(), action: actionSchema,
  }, input => run(async () => observation(await browser.act(input.session, input.observation, input.action))));
  server.tool('close', 'Close the local inspection browser. Saved revisions and server UI previews remain available.', {}, () => run(async () => { await browser.close(); return text({ closed: true }); }));
  const close = server.close.bind(server);
  let closing: Promise<void> | undefined;
  server.close = () => closing ??= (async () => { stopped = true; await queue; try { await browser.close(); } finally { await close(); } })();
  return server;
}
