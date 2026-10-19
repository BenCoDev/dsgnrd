import { and, eq, lte, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { messages, publications } from '../db/schema';
import { publicationContextBoundary } from '../tools/publication_context';
import { saveResearchAsset } from './figma_assets';

// Reuse saved evidence; never download arbitrary model-provided URLs or paths.
export function importResearchAsset(experiment: number, agent: number, input: {
  reference?: string; messageId?: number; toolUseId: string;
}) {
  let author = agent, through = Number.MAX_SAFE_INTEGER;
  if (input.reference) {
    if (input.messageId === undefined) throw new Error('Historical import requires messageId from publication context.');
    const publication = db.select().from(publications).where(and(eq(publications.experiment, experiment), eq(publications.reference, input.reference))).get();
    if (!publication) throw new Error('Publication not found in this experiment.');
    author = publication.author;
    through = publicationContextBoundary(experiment, author, publication).through;
  }
  const message = db.select().from(messages).where(and(input.messageId === undefined ? undefined : eq(messages.id, input.messageId), eq(messages.experiment, experiment), eq(messages.agent, author), lte(messages.position, through), sql`exists (select 1 from json_each(${messages.content}) b where json_extract(b.value, '$.type') = 'tool_result' and json_extract(b.value, '$.toolUseId') = ${input.toolUseId})`)).orderBy(desc(messages.position)).limit(1).get();
  if (!message || message.role !== 'user') throw new Error('Research message is not available within the selected author and publication boundary.');
  const block = message.content.find(b => b.type === 'tool_result' && b.toolUseId === input.toolUseId);
  if (!block || block.type !== 'tool_result' || block.isError || block.toolUseName !== 'web-capture_media') throw new Error('Select a successful web-capture_media result. Design reference screenshots are not product assets.');
  const image = block.content.find(b => b.type === 'image');
  const metadata = block.content.find(b => b.type === 'text');
  if (!image || image.type !== 'image' || !metadata || metadata.type !== 'text') throw new Error('Media capture is incomplete.');
  const evidence = JSON.parse(metadata.text);
  if (evidence.capture !== 'rendered_still' || typeof evidence.pageUrl !== 'string' || typeof evidence.sourceUrl !== 'string') throw new Error('Missing media provenance.');
  return {
    ...saveResearchAsset(image.data, image.mimeType, experiment),
    provenance: { reference: input.reference ?? null, messageId: message.id, toolUseId: input.toolUseId, ...evidence },
    note: 'Rendered website still; not original media or working video. Cite provenance and inspect before designing.',
  };
}
