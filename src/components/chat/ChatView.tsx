"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConversation } from "@/components/chat/ChatProvider";
import { AssistantIcon } from "@/components/chat/AssistantIcon";
import { ProductResults } from "@/components/chat/ProductResults";
import { products } from "@/data/products";
import { WELCOME_ID } from "@/application/chat/history";
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
const starters = [
  {
    label: "My morning coffee",
    text: "I need something for my morning coffee",
  },
  { label: "Finds under €25", text: "What can I buy under EUR 25?" },
  { label: "Delivery & returns", text: "How much is delivery?" },
];
export default function ChatView() {
  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
    draft,
    setDraft,
    ready,
    storageNotice,
    conversationClosed,
    remainingTurns,
    newConversation,
    threadPosition,
  } = useConversation();
  const router = useRouter();
  const thread = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(threadPosition.current.follow);
  const initializedScroll = useRef(false);
  const [showLatest, setShowLatest] = useState(false);
  const [copied, setCopied] = useState<string>();
  const busy = status === "submitted" || status === "streaming";
  const started = messages.some((m) => m.role === "user");
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty("--chat-top", `${top}px`);
    }
    measure();
    const observer = new ResizeObserver(measure);
    document
      .querySelectorAll(".demo-bar, header")
      .forEach((el) => observer.observe(el));
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(window.location.search).get("product");
    if (id && products.some((p) => p.id === id))
      setDraft(`Tell me about product ${id}`);
  }, [ready, setDraft]);
  useEffect(() => {
    if (!ready) return;
    if (!initializedScroll.current && thread.current) {
      thread.current.scrollTop = threadPosition.current.follow
        ? thread.current.scrollHeight
        : threadPosition.current.top;
      initializedScroll.current = true;
    }
    if (nearBottom.current && thread.current) {
      thread.current.scrollTop = thread.current.scrollHeight;
      setShowLatest(false);
    } else setShowLatest(true);
  }, [messages, busy, ready]);
  useEffect(() => {
    const el = thread.current;
    if (!el || !ready) return;
    const observer = new ResizeObserver(() => {
      if (threadPosition.current.follow) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready, threadPosition]);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft, ready]);
  function latest() {
    nearBottom.current = true;
    threadPosition.current.follow = true;
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "smooth",
    });
    setShowLatest(false);
  }
  function send(text: string) {
    if (!ready || busy || conversationClosed || !text.trim()) return;
    nearBottom.current = true;
    threadPosition.current.follow = true;
    setDraft("");
    void sendMessage({ text: text.trim() });
    field.current?.focus();
  }
  async function reset() {
    await newConversation();
    router.replace("/chat", { scroll: false });
    nearBottom.current = true;
    threadPosition.current.follow = true;
    setCopied(undefined);
    field.current?.focus();
  }
  const visible = messages.filter(
    (m) =>
      m.role === "user" ||
      m.parts.some(
        (p) =>
          (p.type === "text" && p.text.trim()) ||
          (p.type.startsWith("tool-") &&
            "state" in p &&
            p.state === "output-available"),
      ),
  );
  const unanswered = !busy && visible.at(-1)?.role === "user";
  return (
    <div className="assistant-workspace">
      <aside className="assistant-intro">
        <span className="eyebrow">AURELLE</span>
        <h1>Shopping assistant</h1>
        <p>All 48 products, prices, stock and policies are mock data.</p>
        <Link className="intro-catalog" href="/#collection">
          Browse products ↗
        </Link>
      </aside>
      <section
        className="chat-panel"
        aria-label="Shopping conversation"
        ref={panel}
      >
        <div className="chat-toolbar">
          <div className="assistant-identity">
            <span className="assistant-avatar">
              <AssistantIcon />
            </span>
            <div>
              <strong>Aurelle assistant</strong>
              <span className="assistant-presence">
                {busy ? "Working on your request…" : "Products, prices and delivery"}
              </span>
            </div>
          </div>
          <button
            className="new-conversation"
            disabled={!ready}
            onClick={() => void reset()}
            title="Clear this chat and start again"
          >
            <span aria-hidden="true">＋</span> New conversation
          </button>
        </div>
        <div
          className="chat-thread"
          ref={thread}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-busy={busy}
          onScroll={() => {
            const el = thread.current;
            if (el) {
              nearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              threadPosition.current = {
                top: el.scrollTop,
                follow: nearBottom.current,
              };
              setShowLatest(!nearBottom.current);
            }
          }}
        >
          {!ready ? (
            <p role="status" className="chat-loading">
              Restoring your conversation…
            </p>
          ) : (
            visible.map((message) => (
              <article
                className={`chat-message ${message.role}`}
                key={message.id}
              >
                <div className="message-caption">
                  {message.role === "user" ? (
                    "You"
                  ) : (
                    <>
                      <AssistantIcon />
                      Aurelle
                    </>
                  )}
                  {message.role === "assistant" &&
                    message.id !== WELCOME_ID &&
                    message.parts.some((p) => p.type === "text" && p.text) && (
                      <button
                        className="copy-reply"
                        onClick={() => {
                          const text = message.parts
                            .filter((p) => p.type === "text")
                            .map((p) => p.text)
                            .join("\n");
                          void navigator.clipboard
                            ?.writeText(text)
                            .then(() => setCopied(message.id))
                            .catch(() => setCopied(undefined));
                        }}
                      >
                        {copied === message.id ? "Copied" : "Copy reply"}
                      </button>
                    )}
                </div>
                {[
                  ...message.parts.filter((p) => p.type === "text"),
                  ...message.parts.filter((p) => p.type !== "text"),
                ].map((part, i) => {
                  if (part.type === "text") return <p key={i}>{part.text}</p>;
                  if (
                    (part.type === "tool-searchProducts" ||
                      part.type === "tool-getProductDetails" ||
                      part.type === "tool-compareProducts") &&
                    part.state === "output-available"
                  )
                    return (
                      <ProductResults
                        key={i}
                        output={
                          part.type === "tool-compareProducts" &&
                          typeof part.output === "object" &&
                          part.output !== null &&
                          "products" in part.output
                            ? part.output.products
                            : part.output
                        }
                      />
                    );
                  return null;
                })}
              </article>
            ))
          )}
          {!started && ready && (
            <div className="chat-starters" aria-label="Conversation starters">
              {starters.map((s) => (
                <button
                  key={s.label}
                  onClick={() => send(s.text)}
                  disabled={busy || conversationClosed}
                >
                  {s.label}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          )}
          {busy && (
            <div className="chat-progress" role="status">
              <span className="progress-dots" aria-hidden="true">
                •••
              </span>
              {status === "submitted"
                ? "Thinking about your request…"
                : "Putting your response together…"}
            </div>
          )}
          {error && (
            <div role="alert" className="chat-error">
              <strong>Let's try that again.</strong>
              <p>{errorText(error.message)}</p>
              <button
                disabled={busy || conversationClosed}
                onClick={() => {
                  nearBottom.current = true;
                  threadPosition.current.follow = true;
                  void regenerate();
                }}
              >
                Retry last message
              </button>
            </div>
          )}
          {unanswered && !error && ready && !conversationClosed && (
            <div className="chat-recovery">
              <p>Your last message has no saved response.</p>
              <button
                onClick={() => {
                  nearBottom.current = true;
                  threadPosition.current.follow = true;
                  void regenerate();
                }}
              >
                Resume response
              </button>
            </div>
          )}
        </div>
        {showLatest && (
          <button className="jump-latest" onClick={latest}>
            Latest response ↓
          </button>
        )}
        {storageNotice && (
          <p className="storage-notice" role="status">
            {storageNotice}
          </p>
        )}
        {conversationClosed && !busy && (
          <div className="chat-recovery" role="status">
            <strong>This conversation is complete.</strong>
            <p>
              Start a new conversation to continue. Your cart stays saved.
            </p>
            <button onClick={() => void reset()}>
              Start a new conversation
            </button>
          </div>
        )}
        {!conversationClosed && remainingTurns <= 3 && (
          <p className="storage-notice">
            {remainingTurns} messages left before starting a new conversation.
          </p>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <label htmlFor="question">What can I help you find?</label>
          <div className="composer-field">
            <textarea
              ref={field}
              id="question"
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder="A coffee ritual, a gift, something for home…"
              enterKeyHint="send"
              aria-describedby="composer-help"
              rows={2}
              disabled={!ready || conversationClosed}
            />
            {busy ? (
              <button
                type="button"
                className="send-message"
                onClick={() => void stop()}
                aria-label="Stop response"
              >
                Stop
              </button>
            ) : (
              <button
                className="send-message"
                disabled={!ready || conversationClosed || !draft.trim()}
                aria-label="Send message"
                type="submit"
              >
                <span aria-hidden="true">↑</span>
                <span className="send-label">Send</span>
              </button>
            )}
          </div>
          <div className="composer-meta" id="composer-help">
            <span className="keyboard-hint">
              Enter to send. Shift + Enter for a new line
            </span>
            <span className="mobile-save-hint">Saved on this device</span>
            <span>{draft.length}/2000</span>
          </div>
        </form>
      </section>
      <details className="demo-capabilities">
        <summary>Try examples</summary>
        <div className="capability-grid">
          {[
            ["Semantic discovery", "I need something for my morning coffee"],
            ["Compare products", "Compare mugs and carafe"],
            ["Gift with a budget", "Find a gift under EUR 25"],
            ["Stock-aware follow-up", "Show only in-stock products"],
            ["Approximate price", "Something for home around EUR 30"],
            ["Language and categories", "Możesz pisać po polsku?"],
            ["Grounded policies", "How much is delivery?"],
            ["Scope boundary", "Write a Python loop"],
          ].map(([title, prompt]) => (
            <button
              key={title}
              disabled={!ready || busy || conversationClosed}
              onClick={() => {
                send(prompt);
                thread.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }}
            >
              {prompt} ↗
            </button>
          ))}
        </div>
        <p className="muted">
          Chat and cart are saved on this device.{" "}
          <Link href="https://github.com/MichalSalek/ecommerce-agent-ai">
            How it works ↗
          </Link>
        </p>
      </details>
    </div>
  );
}
