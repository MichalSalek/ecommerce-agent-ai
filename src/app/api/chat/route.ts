import {
  convertToModelMessages,
  validateUIMessages,
  createUIMessageStreamResponse,
} from "ai";
import {
  conversationUsage,
  MAX_CONVERSATION_TURNS,
  MAX_CONVERSATION_CHARACTERS,
} from "@/application/chat/conversation-limit";
import { settledMessages } from "@/application/chat/history";
import { chatAdmission } from "@/composition/admission";
import { z } from "zod";
import { getShop } from "@/composition/shop";
import { resolveChatRuntime } from "@/composition/chat";
import { createJsonAgentStream } from "@/infrastructure/chat/json-agent-stream";
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
      .object({ messages: z.array(z.unknown()).min(1).max(60) })
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
    const { tools } = getShop();
    const messages = await validateUIMessages({
      messages: normalized,
      tools,
    });
    const modelMessages = await convertToModelMessages(messages);
    const admission = chatAdmission()?.acquire();
    if (admission && !admission.allowed)
      return Response.json(
        {
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
    return createUIMessageStreamResponse({
      stream: createJsonAgentStream(
        runtime.model,
        modelMessages,
        tools,
        signal,
        { ...runtime, onSettled: release },
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
