import { createUIMessageStreamResponse } from "ai";
import {
  conversationUsage,
  MAX_CONVERSATION_TURNS,
  MAX_CONVERSATION_CHARACTERS,
} from "@/application/chat/conversation-limit";
import { settledMessages } from "@/application/chat/history";
import { chatAdmission } from "@/composition/admission";
import { z } from "zod";
import { getShop } from "@/composition/shop";
import { products } from "@/data/products";
import { resolveChatRuntime } from "@/composition/chat";
import { legacyButtonAction } from "@/application/chat/shopping-v3";
import {
  createNativeAgentStream,
  stateFromMessages,
} from "@/infrastructure/chat/native-agent";
export const runtime = "nodejs";
export async function POST(request: Request) {
  console.log("[AGENT] started");
  let release: (() => void) | undefined;
  try {
    const raw = await request.text();
    if (raw.length > 100000)
      return Response.json(
        { error: "Conversation is too long." },
        { status: 413 },
      );
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
                      (id) => products.some((product) => product.id === id),
                      "Unknown cart product.",
                    ),
                  quantity: z.number().int().min(1).max(99),
                }),
              )
              .max(products.length)
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
      return Response.json(
        { error: "Unsupported conversation messages." },
        { status: 400 },
      );
    const usage = conversationUsage(normalized);
    if (
      usage.turns > MAX_CONVERSATION_TURNS ||
      usage.characters > MAX_CONVERSATION_CHARACTERS
    )
      return Response.json(
        {
          error:
            "This conversation has reached its safety limit. Start a new conversation; your cart will be kept.",
          code: "CONVERSATION_LIMIT",
        },
        { status: 409 },
      );
    const shop = getShop();
    const user = normalized.findLast((m) => m.role === "user");
    if (!user || normalized.at(-1)?.role !== "user")
      return Response.json(
        { error: "The final message must be a user turn." },
        { status: 400 },
      );
    const admission = chatAdmission()?.acquire();
    if (admission && !admission.allowed)
      return Response.json(
        {
          code: admission.reason === "busy" ? "BUSY" : "REQUEST_LIMIT",
          retryAfter: admission.retryAfter,
          retryAt: Date.now() + admission.retryAfter * 1000,
          error:
            admission.reason === "busy"
              ? "The assistant is helping other visitors. Please retry in a few seconds."
              : "The demo has reached its hourly conversation limit. Please return later.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(admission.retryAfter),
            "Cache-Control": "no-store",
          },
        },
      );
    release = admission?.allowed ? admission.release : undefined;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(90000),
    ]);
    const runtime = await resolveChatRuntime(signal);
    const text = user.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    const state = stateFromMessages(normalized, user.id);
    return createUIMessageStreamResponse({
      stream: createNativeAgentStream(
        runtime,
        shop.catalog,
        {
          text,
          userMessageId: user.id,
          conversationId: body.conversationId,
          state,
          action:
            user.metadata?.shoppingAction ?? legacyButtonAction(text, state),
          cart: body.cart?.lines,
          history: normalized
            .slice(0, -1)
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
          onSettled: release,
          contract: body.contract,
        },
      ),
    });
  } catch (error) {
    release?.();
    console.error(
      "[AGENT] failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Invalid conversation format."
            : "The assistant is temporarily unavailable. Your message is saved — please try again.",
      },
      {
        status:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 503,
      },
    );
  }
}
