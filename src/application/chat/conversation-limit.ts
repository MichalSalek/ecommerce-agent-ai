import type { ChatMessage } from "@/types/shop";
export const MAX_CONVERSATION_TURNS = 20;
export const MAX_CONVERSATION_CHARACTERS = 24000;
export function conversationUsage(messages: readonly ChatMessage[]) {
  const turns = messages.filter((m) => m.role === "user").length;
  const characters = messages.reduce(
    (sum, m) =>
      sum +
      m.parts
        .filter((p) => p.type === "text")
        .reduce((n, p) => n + p.text.length, 0),
    0,
  );
  return {
    turns,
    characters,
    closed:
      turns >= MAX_CONVERSATION_TURNS ||
      characters >= MAX_CONVERSATION_CHARACTERS,
    remaining: Math.max(0, MAX_CONVERSATION_TURNS - turns),
  };
}
