import type { LanguageModel, JSONValue } from "ai";
export interface ChatRuntime {
  model: LanguageModel;
  label: string;
  providerOptions: Record<string, Record<string, JSONValue>>;
  maxOutputTokens: number;
}
