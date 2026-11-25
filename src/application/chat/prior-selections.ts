import { catalogById } from "@/data/products";
import type { ChatMessage } from "@/types/shop";

/** Recover only selections actually presented for the preceding customer message. */
export function priorProductGroups(messages: readonly ChatMessage[]) {
  const groups: { userText: string; productIds: string[] }[] = [];
  let user: ChatMessage | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      user = message;
      continue;
    }
    if (!user || message.role !== "assistant") continue;
    const checkpoint = message.parts.findLast((part) => part.type === "data-shoppingState")?.data;
    if (!checkpoint || checkpoint.userMessageId !== user.id) continue;
    const text = user.parts.filter((part) => part.type === "text").map((part) => part.text).join(" ");
    if (checkpoint.text !== text) continue;
    const ids = [...new Set(checkpoint.presentedIds)].filter((id) => catalogById.has(id));
    if (ids.length) groups.push({ userText: text, productIds: ids });
  }
  return groups;
}
