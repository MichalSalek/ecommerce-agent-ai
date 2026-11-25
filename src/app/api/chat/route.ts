import { createUIMessageStreamResponse } from "ai";
import {
  conversationUsage,
  MAX_CONVERSATION_TURNS,
  MAX_CONVERSATION_CHARACTERS,
} from "@/application/chat/conversation-limit";
import { priorProductGroups } from "@/application/chat/prior-selections";
import { settledMessages } from "@/application/chat/history";
import { chatAdmission } from "@/composition/admission";
import { z } from "zod";
import { getShop } from "@/composition/shop";
import { catalogById } from "@/data/products";
import { resolveChatRuntime, catalogOnlyRuntime } from "@/composition/chat";
import { legacyButtonAction } from "@/application/chat/shopping-v3";
import {
  createNativeAgentStream,
  stateFromMessages,
  adviceResultFromMessages,
  needsModel,
  shoppingOperationId,
} from "@/infrastructure/chat/native-agent";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const attemptId = crypto.randomUUID();
  let operationId: string | undefined;
  let stage = "validation";
  let release: (() => void) | undefined;
  function reject(status: number, error: string, code: string, retryAfter?: number) {
    console.info("[AGENT] terminal", JSON.stringify({ attemptId, operationId, stage, status: "failed", code, http: status }));
    return Response.json(
      { error, code, ...(retryAfter === undefined ? {} : { retryAfter, retryAt: Date.now() + retryAfter * 1000 }) },
      { status, headers: { "X-Request-ID": attemptId, "Cache-Control": "no-store", ...(retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) }) } },
    );
  }
  try {
    const raw = await request.text();
    if (raw.length > 100000)
      return reject(413, "Conversation is too long.", "REQUEST_SIZE");
    const body = z
      .object({
        messages: z.array(z.unknown()).min(1).max(60),
        contract: z.enum(["shopping-v2", "shopping-v3"]).optional(),
        conversationId: z.string().min(1).max(150).optional(),
        cart: z
          .object({
            lines: z
              .array(
                z.object({
                  productId: z
                    .string()
                    .max(150)
                    .refine(
                      (id) => catalogById.has(id),
                      "Unknown cart product.",
                    ),
                  quantity: z.number().int().min(1).max(99),
                }),
              )
              .max(catalogById.size)
              .refine(
                (lines) =>
                  new Set(lines.map((line) => line.productId)).size ===
                  lines.length,
                "Duplicate cart lines.",
              ),
          })
          .optional(),
      })
      .parse(JSON.parse(raw));
    const normalized = settledMessages(body.messages);
    if (normalized.length !== body.messages.length)
      return reject(400, "Unsupported conversation messages.", "INVALID_HISTORY");
    const user = normalized.at(-1);
    if (!user || user.role !== "user")
      return reject(400, "The final message must be a user turn.", "INVALID_FINAL_ROLE");
    operationId = shoppingOperationId(body.conversationId, user.id);
    const usage = conversationUsage(normalized);
    if (
      usage.turns > MAX_CONVERSATION_TURNS ||
      usage.characters > MAX_CONVERSATION_CHARACTERS
    )
      return reject(409, "This conversation has reached its safety limit. Start a new conversation; your cart will be kept.", "CONVERSATION_LIMIT");
    stage = "admission";
    const shop = getShop();
    const admission = chatAdmission()?.acquire();
    if (admission && !admission.allowed)
      return reject(
        429,
        admission.reason === "busy"
          ? "The assistant is helping other visitors. Please retry in a few seconds."
          : "The demo has reached its hourly conversation limit. Please return later.",
        admission.reason === "busy" ? "BUSY" : "REQUEST_LIMIT",
        admission.retryAfter,
      );
    release = admission?.allowed ? admission.release : undefined;
    stage = "setup";
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(30000),
    ]);
    const text = user.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    const state = stateFromMessages(normalized, user.id);
    const action =
      user.metadata?.shoppingAction ?? legacyButtonAction(text, state);
    const runtime = needsModel({ text, action })
      ? await resolveChatRuntime(signal)
      : catalogOnlyRuntime;
    const previous = normalized.slice(0, -1);
    return createUIMessageStreamResponse({
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "X-Request-ID": attemptId },
      stream: createNativeAgentStream(
        runtime,
        shop.catalog,
        {
          text,
          userMessageId: user.id,
          conversationId: body.conversationId,
          state,
          action,
          adviceFor:
            action?.type === "advice"
              ? adviceResultFromMessages(normalized, action.operationId)
              : undefined,
          cart: body.cart?.lines,
          priorProductGroups: priorProductGroups(previous),
          history: previous
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join(" "),
            })),
        },
        signal,
        {
          attemptId,
          onSettled: release,
          contract: body.contract,
        },
      ),
    });
  } catch (error) {
    release?.();
    if (stage === "validation" && (error instanceof z.ZodError || error instanceof SyntaxError))
      return reject(400, "Invalid conversation format.", "INVALID_FORMAT");
    return reject(503, "The assistant is temporarily unavailable. Your message is saved. Please try again.", "UNAVAILABLE");
  }
}
