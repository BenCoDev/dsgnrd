import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { agents, figma_destinations, figma_operations } from '../db/schema';
import type { FigmaDestination } from '../integrations/figma';

export type FigmaOperation = typeof figma_operations.$inferSelect;
export interface FigmaStore {
  destination(experiment: number): FigmaDestination;
  validateAgent(experiment: number, agent: number): void;
  operation(agent: number, key: string): FigmaOperation | undefined;
  pending(experiment: number): FigmaOperation[];
  begin(experiment: number, agent: number, key: string, request: string): FigmaOperation;
  finish(id: string, result: string): void;
}
export const figmaStore: FigmaStore = {
  destination(experiment) {
    const destination = db.select().from(figma_destinations).where(eq(figma_destinations.experiment, experiment)).get();
    if (!destination) throw new Error('No Figma destination. Run: dsgnrd figma configure -e EXPERIMENT --file-key KEY --page-id ID');
    return destination;
  },
  validateAgent(experiment, agent) {
    if (!db.select().from(agents).where(and(eq(agents.id, agent), eq(agents.experiment, experiment))).get()) throw new Error('Agent does not belong to this experiment.');
  },
  operation(agent, key) { return db.select().from(figma_operations).where(and(eq(figma_operations.agent, agent), eq(figma_operations.operation_key, key))).get(); },
  pending(experiment) { return db.select().from(figma_operations).where(and(eq(figma_operations.experiment, experiment), eq(figma_operations.status, 'pending'))).all(); },
  begin(experiment, agent, operation_key, request) {
    return db.insert(figma_operations).values({ id: randomUUID(), experiment, agent, operation_key, request, status: 'pending' }).returning().get();
  },
  finish(id, result) { db.update(figma_operations).set({ status: 'complete', result }).where(eq(figma_operations.id, id)).run(); },
};

export function configureFigma(experiment: number, fileKey: string, pageId: string): FigmaDestination {
  if (!/^[a-zA-Z0-9]+$/.test(fileKey) || !/^\d+:\d+$/.test(pageId)) throw new Error('Expected a Figma file key and page ID such as 0:1.');
  const current = db.select().from(figma_destinations).where(eq(figma_destinations.experiment, experiment)).get();
  if (current) {
    if (current.file_key !== fileKey || current.page_id !== pageId) throw new Error('This experiment already has a different Figma destination. Create a new experiment to change it.');
    return current;
  }
  return db.insert(figma_destinations).values({ experiment, scope: randomUUID(), file_key: fileKey, page_id: pageId }).returning().get();
}
