import type { LanguageModel, JSONValue } from "ai";
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
export interface ChatRuntime {
  model: LanguageModel;
  label: string;
  providerOptions: Record<string, Record<string, JSONValue>>;
  maxOutputTokens: number;
  takeUsage?: () => ModelUsage[];
}
