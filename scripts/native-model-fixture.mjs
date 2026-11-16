// Deterministic OpenAI-compatible tool-calling peer for container smoke only.
import http from "node:http";

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    const toolMessage = [...request.messages]
      .reverse()
      .find((m) => m.role === "tool");
    let name, args;
    if (!toolMessage) {
      name = "searchProducts";
      const current = [...request.messages]
        .reverse()
        .find((m) => m.role === "user");
      const semanticCoffee =
        typeof current?.content === "string" &&
        current.content.includes("[fixture-semantic-coffee]");
      args = {
        mode: "recommend",
        operation: "new",
        language: "en",
        criteria: semanticCoffee
          ? {
              query: "morning coffee",
              functionalGroup: "coffee",
            }
          : {},
        requestedCount: 10,
        continueWith: "presentAnswer",
      };
    } else {
      const content =
        typeof toolMessage.content === "string"
          ? toolMessage.content
          : JSON.stringify(toolMessage.content);
      const parsed = JSON.parse(content);
      const output = parsed.value ?? parsed;
      if (!output.evidenceId || !Array.isArray(output.products))
        throw new Error("Expected native search tool result");
      name = "presentAnswer";
      args = {
        text: "Here are products from the collection.",
        language: "en",
        evidenceIds: [output.evidenceId],
        productIds: output.products.map((p) => p.id),
        view: "products",
      };
    }
    const response = {
      id: `fixture-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call-${crypto.randomUUID()}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(response));
  } catch (error) {
    res
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: { message: error.message } }));
  }
});
server.listen(9999, "127.0.0.1", () =>
  console.log("[fixture] native tool peer listening"),
);
