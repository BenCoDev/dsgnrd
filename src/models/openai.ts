export type OpenAIModel =
  | "gpt-4.1"
  | "gpt-5-nano"
  | "gpt-5-mini"
  | "gpt-5"
  | "gpt-5-codex"
  | "gpt-5.1"
  | "gpt-5.1-codex"
  | "gpt-5.2"
  | "gpt-5.2-codex"
  | "gpt-5.3-codex"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "gpt-5.4-pro"
  | "gpt-5.5"
  | "gpt-5.5-pro"
  | "gpt-5.6"
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gpt-5.6-luna"
  | "gpt-5.6-cyber";
export function isOpenAIModel(model: string): model is OpenAIModel {
  return [
    "gpt-4.1",
    "gpt-5-nano",
    "gpt-5-mini",
    "gpt-5",
    "gpt-5-codex",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4-pro",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.6-cyber",
  ].includes(model);
}
