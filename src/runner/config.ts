export type RunConfig = {
  reviewers: number;
  // Optional participant filter for bounded runs in an existing experiment.
  reviewerAgentIds?: number[];
};
