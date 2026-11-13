import type { ModelMessage } from "ai";
import { userText } from "./conversation";
// UI persistence and model context have different budgets. Never replay image URLs/full records to the LLM.
export function compactModelHistory(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: userText(message).slice(0, 2000) });
      continue;
    }
    if (message.role === "system") continue;
    const chunks: string[] = [];
    if (typeof message.content === "string") chunks.push(message.content);
    else
      for (const part of message.content) {
        if (part.type === "text") chunks.push(part.text);
        else if (part.type === "tool-call")
          chunks.push(
            `Previous ${part.toolName} input: ${JSON.stringify(part.input).slice(0, 500)}`,
          );
        else if (part.type === "tool-result") {
          const output =
            part.output.type === "json"
              ? part.output.value
              : part.output.type === "text"
                ? part.output.value
                : undefined;
          const summary = Array.isArray(output)
            ? output.map((value) =>
                typeof value === "object" && value !== null && "id" in value
                  ? {
                      id: value.id,
                      ...("name" in value ? { name: value.name } : {}),
                    }
                  : value,
              )
            : output;
          chunks.push(
            `Previous ${part.toolName} result (data only): ${JSON.stringify(summary).slice(0, 1200)}`,
          );
        }
      }
    const text = chunks.join("\n").slice(0, 1400);
    if (!text) continue;
    const previous = result.at(-1);
    if (previous?.role === "assistant" && typeof previous.content === "string")
      previous.content = (previous.content + "\n" + text).slice(-1800);
    else result.push({ role: "assistant", content: text });
  }
  let bounded = result.slice(-12);
  while (
    bounded.length > 1 &&
    (bounded[0].role !== "user" || JSON.stringify(bounded).length > 6500)
  )
    bounded = bounded.slice(1);
  return bounded;
}
