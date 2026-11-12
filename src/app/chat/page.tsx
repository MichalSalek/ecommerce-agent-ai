"use client";
import { useState, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ProductCard } from "@/components/ProductCard";
import type { ChatMessage } from "@/types/shop";
import { productSchema } from "@/domain/catalog/product";
const transport = new DefaultChatTransport({ api: "/api/chat" });
function errorText(message: string) {
  try {
    const body: unknown = JSON.parse(message);
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    )
      return body.error;
  } catch {
    /* Plain SDK error. */
  }
  return message;
}
export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat<ChatMessage>({
    transport,
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("product");
    if (id) setInput(`Tell me about product ${id}`);
  }, []);
  const busy = status === "submitted" || status === "streaming";
  function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    void sendMessage({ text });
  }
  return (
    <div className="chat-shell">
      <div className="chat-heading">
        <small>AURELLE ASSISTANT</small>
        <h1>A little help finding your thing.</h1>
        <p>Ask about products, availability, delivery or returns.</p>
      </div>
      {!messages.length && (
        <div className="suggestions">
          {[
            "I need something for my morning coffee",
            "What can I buy under EUR 25?",
            "How much is delivery?",
          ].map((text) => (
            <button key={text} disabled={busy} onClick={() => send(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="messages" aria-live="polite">
        {messages.map((message) => (
          <section className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            {message.parts.map((part, i) => {
              if (part.type === "text") return <p key={i}>{part.text}</p>;
              if (
                (part.type === "tool-searchProducts" ||
                  part.type === "tool-getProductDetails") &&
                part.state === "output-available" &&
                (Array.isArray(part.output) ||
                  productSchema.safeParse(part.output).success)
              )
                return (
                  <div key={i}>
                    {Array.isArray(part.output) && part.output.length === 0 ? (
                      <p>No matching products found.</p>
                    ) : (
                      <div className="grid">
                        {(Array.isArray(part.output)
                          ? part.output
                          : [part.output]
                        )
                          .map((value) => productSchema.parse(value))
                          .map((product) => (
                            <ProductCard key={product.id} product={product} />
                          ))}
                      </div>
                    )}
                  </div>
                );
              return null;
            })}
          </section>
        ))}
      </div>
      {busy && <p role="status">Checking the catalog...</p>}
      {error && (
        <p role="alert" className="error">
          {errorText(error.message)}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="question">Your message</label>
        <div className="input-row">
          <textarea
            id="question"
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What are you looking for?"
            rows={2}
          />
          {busy ? (
            <button type="button" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button disabled={!input.trim()} type="submit">
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
