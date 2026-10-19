import { eq } from 'drizzle-orm';
import { db } from '../db';
import { messages } from '../db/schema';
import { isScreenshot } from '../lib/images';
import { prototypePath } from '../integrations/prototype';
import { sanitizeText } from './styling';

export function renderPrototypePreviews(experiment: number, publication: { content: string; created: Date }) {
  const cited = new Set([...publication.content.matchAll(/\/experiments\/(\d+)\/prototypes\/(\d+)\/([a-f0-9]{64})(?![a-f0-9])/g)]
    .filter(m => Number(m[1]) === experiment).map(m => prototypePath(experiment, Number(m[2]), m[3])));
  if (!cited.size) return '';
  const selected = new Map<string, { path: string; png: string; width: number; height: number; captured: number; revision: string }>();
  for (const row of db.select({ content: messages.content }).from(messages).where(eq(messages.experiment, experiment)).all()) {
    for (const item of row.content) {
      if (item.type !== 'tool_result' || item.isError || !['prototype-inspect', 'prototype-act'].includes(item.toolUseName)) continue;
      const text = item.content.find(c => c.type === 'text'), image = item.content.find(c => c.type === 'image');
      if (!text || !image || image.mimeType !== 'image/png' || !isScreenshot(image.data, image.mimeType)) continue;
      try {
        const data = JSON.parse(text.text);
        const path = prototypePath(experiment, data.author, data.revision), captured = Date.parse(data.inspectedAt);
        const { width, height } = data.viewport;
        if (!cited.has(path) || !Number.isFinite(captured) || captured >= publication.created.getTime() + 1000 ||
            !Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 1440 || height < 480 || height > 1200) continue;
        const key = `${path}/${width}/${height}`;
        if ((selected.get(key)?.captured ?? 0) <= captured) selected.set(key, { path, png: image.data, width, height, captured, revision: data.revision });
      } catch { /* Malformed evidence remains in the conversation, not in preview markup. */ }
    }
  }
  return selected.size ? `<div class="figma-previews">${[...selected.values()].slice(-3).map(p => `<figure class="figma-preview"><a href="${sanitizeText(p.path)}" target="_blank" rel="noopener noreferrer"><img src="data:image/png;base64,${p.png}" loading="lazy" alt="Saved prototype observation at ${p.width} by ${p.height}"></a><figcaption><a href="${sanitizeText(p.path)}" target="_blank" rel="noopener noreferrer">Open interactive prototype ↗</a><small>Revision ${p.revision.slice(0, 12)} · ${p.width} × ${p.height} · saved observation; opening resets state</small></figcaption></figure>`).join('')}</div>` : '';
}
