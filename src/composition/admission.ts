import { z } from "zod";
import { ChatAdmission } from "@/application/chat/admission";
let guard: ChatAdmission | undefined;
export function chatAdmission() {
  if (process.env.NODE_ENV !== "production") return undefined;
  const value = (input: string | undefined, fallback: number) =>
    z.coerce
      .number()
      .int()
      .positive()
      .parse(input ?? fallback);
  return (guard ??= new ChatAdmission(
    value(process.env.CHAT_MAX_CONCURRENT, 2),
    value(process.env.CHAT_REQUESTS_PER_HOUR, 120),
    60 * 60 * 1000,
  ));
}
