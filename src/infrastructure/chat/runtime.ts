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
  stableAdviceTools?: boolean;
  currentRoute?: () => { modelId: string; reason: string };
  takeUsage?: () => ModelUsage[];
  setWaitListener?: (
    listener: ((milliseconds: number) => void) | undefined,
  ) => void;
  setSwitchListener?: (
    listener: ((modelId: string) => void) | undefined,
  ) => void;
}
