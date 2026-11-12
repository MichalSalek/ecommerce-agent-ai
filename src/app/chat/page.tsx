"use client";
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ProductCard } from "@/components/ProductCard";
import type { ChatMessage, Product } from "@/types/shop";
const transport = new DefaultChatTransport({ api: "/api/chat" });
function isProduct(value: unknown): value is Product {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "price" in value &&
    typeof value.price === "number" &&
    "name" in value &&
    typeof value.name === "string" &&
    "imageUrl" in value &&
    typeof value.imageUrl === "string" &&
    "productUrl" in value &&
    typeof value.productUrl === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "category" in value &&
    typeof value.category === "string" &&
    "inStock" in value &&
    typeof value.inStock === "boolean"
  );
}
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
  const busy = status === "submitted" || status === "streaming";
  function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    void sendMessage({ text });
  }
  return (
    <div className="chat-shell">
      <div className="chat-heading">
        <small>ASYSTENT AURELLE</small>
        <h1>Znajdź coś dla siebie.</h1>
        <p>Zapytaj o produkty, dostępność, dostawę lub zwroty.</p>
      </div>
      {!messages.length && (
        <div className="suggestions">
          {[
            "Szukam czegoś do kawy",
            "Co kupię do 100 zł?",
            "Ile kosztuje dostawa?",
          ].map((text) => (
            <button key={text} onClick={() => send(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      <div className="messages" aria-live="polite">
        {messages.map((message) => (
          <section className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "Ty" : "Asystent"}</strong>
            {message.parts.map((part, i) => {
              if (part.type === "text") return <p key={i}>{part.text}</p>;
              if (
                part.type === "tool-searchProducts" &&
                part.state === "output-available" &&
                Array.isArray(part.output)
              )
                return (
                  <div key={i}>
                    {part.output.length === 0 ? (
                      <p>Brak pasujących produktów.</p>
                    ) : (
                      <div className="grid">
                        {part.output.filter(isProduct).map((product) => (
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
      {busy && <p role="status">Asystent sprawdza ofertę…</p>}
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
        <label htmlFor="question">Twoja wiadomość</label>
        <div className="input-row">
          <textarea
            id="question"
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Czego szukasz?"
            rows={2}
          />
          {busy ? (
            <button type="button" onClick={() => void stop()}>
              Zatrzymaj
            </button>
          ) : (
            <button disabled={!input.trim()} type="submit">
              Wyślij ↗
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
