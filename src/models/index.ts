export type ThinkingConfig = "high" | "low" | "none";

export function isThinkingConfig(str: string): str is ThinkingConfig {
  return ["high", "low", "none"].includes(str);
}
