export type GeminiModel =
  | "gemini-3.1-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite";
export function isGeminiModel(model: string): model is GeminiModel {
  return [
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ].includes(model);
}
