import { assertNever } from "@app/lib/assert";
import { AnthropicModel, isAnthropicModel } from "./anthropic";
import { GeminiModel, isGeminiModel } from "./gemini";
import { isMistralModel, MistralModel } from "./mistral";
import { isMoonshotAIModel, MoonshotAIModel } from "./moonshotai";
import { isDeepseekModel, DeepseekModel } from "./deepseek";
import { isOpenAIModel, OpenAIModel } from "./openai";
import { isZhipuModel, ZhipuModel } from "./zhipu";
import { isStepfunModel, StepfunModel } from "./stepfun";

export type Model =
  | AnthropicModel
  | GeminiModel
  | OpenAIModel
  | MistralModel
  | MoonshotAIModel
  | DeepseekModel
  | ZhipuModel
  | StepfunModel;

export type provider =
  | "openai"
  | "moonshotai"
  | "deepseek"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "zhipu"
  | "stepfun";

export function isProvider(str: string): str is provider {
  return [
    "gemini",
    "anthropic",
    "openai",
    "mistral",
    "moonshotai",
    "deepseek",
    "zhipu",
    "stepfun",
  ].includes(str);
}

export function providerFromModel(
  model:
    | OpenAIModel
    | MoonshotAIModel
    | AnthropicModel
    | GeminiModel
    | MistralModel
    | DeepseekModel
    | ZhipuModel
    | StepfunModel,
): provider {
  if (isOpenAIModel(model)) return "openai";
  if (isMoonshotAIModel(model)) return "moonshotai";
  if (isAnthropicModel(model)) return "anthropic";
  if (isGeminiModel(model)) return "gemini";
  if (isMistralModel(model)) return "mistral";
  if (isDeepseekModel(model)) return "deepseek";
  if (isZhipuModel(model)) return "zhipu";
  if (isStepfunModel(model)) return "stepfun";
  else assertNever(model);
}

