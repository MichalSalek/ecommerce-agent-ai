import {
  ToolLoopAgent,
  stepCountIs,
  convertToModelMessages,
  validateUIMessages,
  createUIMessageStreamResponse,
} from "ai";
import { z } from "zod";
import { getShop, chatConfig } from "@/composition/shop";
import { instructions } from "@/application/chat/instructions";
import { resolveLlamaModel } from "@/infrastructure/chat/llama-model";
import { createJsonAgentStream } from "@/infrastructure/chat/json-agent-stream";
export const runtime = "nodejs";
export async function POST(request: Request) {
  console.log("[AGENT] started");
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
    const { tools } = getShop();
    const messages = await validateUIMessages({
      messages: body.messages,
      tools,
    });
    const modelMessages = await convertToModelMessages(messages);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(90000),
    ]);
    const config = chatConfig();
    const model = await resolveLlamaModel(config, signal);
    if (config.mode === "json")
      return createUIMessageStreamResponse({
        stream: createJsonAgentStream(model, modelMessages, tools, signal),
      });
    const agent = new ToolLoopAgent({
      model,
      instructions,
      tools,
      stopWhen: stepCountIs(5),
      maxRetries: 0,
    });
    const result = await agent.stream({
      messages: modelMessages,
      abortSignal: signal,
    });
    return result.toUIMessageStreamResponse({
      onFinish: () => console.log("[AGENT] finished"),
      onError: () => {
        console.error("[LLM] generation failed");
        return "The model could not answer. Check the server console.";
      },
    });
  } catch (error) {
    console.error(
      "[AGENT] failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Invalid conversation format."
            : error instanceof Error
              ? error.message
              : "Chat failed.",
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
