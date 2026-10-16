import { db } from "../db";
import { messages } from "../db/schema";
import { eq } from "drizzle-orm";
import { isScreenshot } from "../lib/images";
import { sanitizeText } from "./styling";

type Preview = { key: string; owner: number; url: string; title: string; revision: number; captured: number; png: string };

export function figmaPreviews(experiment: number): Preview[] {
  const previews: Preview[] = [];
  for (const row of db.select({ content: messages.content }).from(messages).where(eq(messages.experiment, experiment)).all()) {
    for (const item of row.content) {
      if (item.type !== "tool_result" || item.isError || !item.toolUseName.startsWith("figma-")) continue;
      const text = item.content.find(c => c.type === "text");
      const image = item.content.find(c => c.type === "image");
      if (!text || !image || !isScreenshot(image.data, image.mimeType)) continue;
      try {
        const data = JSON.parse(text.text);
        const captured = Date.parse(data.inspectedAt);
        if (!/^[a-zA-Z0-9]+$/.test(data.fileKey) || !/^\d+:\d+$/.test(data.frameId) ||
            !Number.isInteger(data.revision) || data.revision < 1 || !Number.isFinite(captured)) continue;
        previews.push({ key: `${data.fileKey}/${data.frameId}`, owner: data.owner, title: String(data.title ?? "Figma frame"),
          url: `https://www.figma.com/design/${data.fileKey}?node-id=${data.frameId.replace(":", "-")}`,
          revision: data.revision, captured, png: image.data });
      } catch { /* Older or malformed evidence remains visible in the conversation. */ }
    }
  }
  return previews.sort((a, b) => a.captured - b.captured);
}

// Publications use the last saved observation available at publication time,
// never a later revision of the same mutable Figma link.
export function selectFigmaPreviews(previews: Preview[], publication?: { content: string; created: Date }): Preview[] {
  let keys: Set<string> | undefined;
  if (publication) {
    keys = new Set();
    for (const match of publication.content.matchAll(/https:\/\/(?:www\.)?figma\.com\/[^\s<>"')\]]+/g)) {
      try {
        const url = new URL(match[0].replaceAll("&amp;", "&"));
        const file = url.pathname.match(/^\/(?:design|file)\/([a-zA-Z0-9]+)(?:\/|$)/)?.[1];
        const node = url.searchParams.get("node-id")?.replace("-", ":");
        if (file && node && /^\d+:\d+$/.test(node)) keys.add(`${file}/${node}`);
      } catch { /* Not a frame link. */ }
    }
  }
  const latest = new Map<string, Preview>();
  for (const preview of previews) {
    if (keys && !keys.has(preview.key)) continue;
    // Publication timestamps are stored with second precision.
    if (publication && preview.captured >= publication.created.getTime() + 1000) continue;
    latest.set(preview.key, preview);
  }
  return [...latest.values()];
}

export function renderFigmaPreviews(previews: Preview[], publication?: { content: string; created: Date }): string {
  const selected = selectFigmaPreviews(previews, publication);
  if (!selected.length) return "";
  return `<div class="figma-previews">${selected.map(p => `
    <figure class="figma-preview">
      <a href="${sanitizeText(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${sanitizeText(p.title)} in Figma">
        <img src="data:image/png;base64,${p.png}" alt="Saved preview of ${sanitizeText(p.title)}, revision ${p.revision}" loading="lazy">
      </a>
      <figcaption><a href="${sanitizeText(p.url)}" target="_blank" rel="noopener noreferrer">${sanitizeText(p.title)} ↗</a>
        <small>Saved revision ${p.revision} · ${sanitizeText(new Date(p.captured).toLocaleString())}</small>
      </figcaption>
    </figure>`).join("")}</div>`;
}
