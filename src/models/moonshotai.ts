export type MoonshotAIModel =
  | "kimi-k2-thinking"
  | "kimi-k2.5"
  | "kimi-k2.6"
  | "kimi-k3";
export function isMoonshotAIModel(model: string): model is MoonshotAIModel {
  return ["kimi-k2-thinking", "kimi-k2.5", "kimi-k2.6", "kimi-k3"].includes(
    model,
  );
}
