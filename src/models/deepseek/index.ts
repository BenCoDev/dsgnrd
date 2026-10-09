export type DeepseekModel = "deepseek-chat" | "deepseek-reasoner" | "deepseek-v4-pro";
export function isDeepseekModel(model: string): model is DeepseekModel {
  return ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"].includes(model);
}
