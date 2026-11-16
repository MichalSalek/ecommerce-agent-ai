"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConversation } from "@/components/chat/ChatProvider";
import { AssistantIcon } from "@/components/chat/AssistantIcon";
import { ProductResults } from "@/components/chat/ProductResults";
import { CategoryResults } from "@/components/chat/CategoryResults";
import { ComparisonResults } from "@/components/chat/ComparisonResults";
import { useCart, type ActionResult } from "@/components/CartProvider";
import { products } from "@/data/products";
import { WELCOME_ID } from "@/application/chat/history";
import { shoppingStarters, shoppingExamples } from "@/application/chat/shopping-v3";
import { assistantTextError, resolveLanguage, type Language } from "@/application/chat/assistant-text";
import type {
  TurnStatus,
  ChatProgress,
  ShoppingAction,
} from "@/application/chat/shopping-v3";
import type { ChatMessage } from "@/types/shop";
function isFailedMessage(message: ChatMessage): boolean {
  const operation = message.parts.findLast((part) => part.type === "data-operation");
  if (operation?.type === "data-operation") return operation.data.status === "failed";
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part) =>
        part.type === "data-turnStatus" && part.data.status !== "complete",
    )
  );
}
const progressLabels: Record<
  ChatProgress["phase"] | "provider-switch",
  string
> = {
  understanding: "Understanding your request…",
  catalog: "Searching the collection…",
  details: "Checking product details…",
  comparison: "Comparing products…",
  cart: "Preparing your cart selection…",
  answer: "Putting your response together…",
  "provider-wait": "Waiting for the assistant to become available…",
  "provider-switch": "Switching to an available model…",
};
function failureMessage(failure: TurnStatus): string {
  if (failure.providerLimit) {
    const { metric, window } = failure.providerLimit;
    return `The model provider has reached its ${window === "day" ? "daily" : "per-minute"} ${metric === "tokens" ? "token" : "request"} limit.`;
  }
  if (failure.message) return failure.message;
  if (failure.code === "REQUEST_LIMIT")
    return "This demo has reached its hourly request limit.";
  if (failure.code === "BUSY")
    return "The assistant is helping other visitors.";
  if (failure.code === "TIMEOUT")
    return "The response took too long. Your message is saved.";
  if (failure.status === "partial")
    return "The response is incomplete. You can try again.";
  if (failure.status === "provider-limit")
    return "The model provider has reached its limit.";
  return "The response could not be completed. Please try again.";
}
function waitLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
export default function ChatView() {
  const {
    id: conversationId,
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
    cartFeedback,
    progress,
    httpFailure,
    cooldown,
  } = useConversation();
  const { applyAction } = useCart();
  const router = useRouter();
  const thread = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(threadPosition.current.follow);
  const initializedScroll = useRef(false);
  const retryAllowed = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [copied, setCopied] = useState<string>();
  const [clock, setClock] = useState(() => Date.now());
  const [cartRetryStatus, setCartRetryStatus] = useState<
    Record<string, ActionResult>
  >({});
  const busy = status === "submitted" || status === "streaming";
  const started = messages.some((m) => m.role === "user");
  const retrySeconds = Math.max(
    0,
    Math.ceil(((cooldown?.retryAt ?? 0) - clock) / 1000),
  );
  const limited = retrySeconds > 0;
  useEffect(() => {
    setClock(Date.now());
    if (!cooldown?.retryAt || cooldown.retryAt <= Date.now()) return;
    const end = cooldown.retryAt;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= end) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown?.retryAt]);
  useEffect(() => {
    retryAllowed.current = true;
  }, [conversationId]);
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
  function send(text: string, shoppingAction?: ShoppingAction) {
    if (
      !ready ||
      busy ||
      conversationClosed ||
      (shoppingAction?.type === "advice" && (cooldown?.retryAt ?? 0) > Date.now()) ||
      !text.trim()
    )
      return;
    nearBottom.current = true;
    threadPosition.current.follow = true;
    if (!shoppingAction) setDraft("");
    void sendMessage({
      text: text.trim(),
      ...(shoppingAction ? { metadata: { shoppingAction } } : {}),
    });
    field.current?.focus();
  }
  async function reset() {
    retryAllowed.current = false;
    try {
      await newConversation();
    } catch (error) {
      retryAllowed.current = true;
      throw error;
    }
    setCartRetryStatus({});
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
          p.type === "data-products" ||
          p.type === "data-categories" ||
          p.type === "data-comparison" ||
          p.type === "data-operation" ||
          p.type === "data-advice" ||
          p.type === "data-turnStatus" ||
          (p.type.startsWith("tool-") &&
            "state" in p &&
            p.state === "output-available"),
      ),
  );
  const unanswered = !busy && visible.at(-1)?.role === "user";
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const latestTypedFailure = messages
    .slice(lastUserIndex + 1)
    .filter((message) => isFailedMessage(message))
    .flatMap((message) => (message.role === "assistant" ? message.parts : []))
    .findLast(
      (part) =>
        part.type === "data-turnStatus" && part.data.status !== "complete",
    );
  const latestCompleted = messages.slice(lastUserIndex + 1).some((message) => message.parts.some((part) => part.type === "data-operation" && part.data.status !== "failed"));
  const latestFailed = Boolean(latestTypedFailure || messages.slice(lastUserIndex + 1).some(isFailedMessage) || (!latestCompleted && (error || httpFailure)));
  let language: Language = "en";
  const languages = new Map<string, Language>();
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join(" ");
      language = resolveLanguage(text, language, Boolean(message.metadata?.shoppingAction));
    }
    const state = message.parts.findLast((part) => part.type === "data-shoppingState");
    if (state?.type === "data-shoppingState") language = state.data.after.language;
    languages.set(message.id, language);
  }
  const latestRead = messages.flatMap((message) => message.parts)
    .findLast((part) => part.type === "data-operation" && part.data.status === "completed" && ["search", "details", "comparison", "categories", "overview", "policy"].includes(part.data.kind));
  const lastAdvice = messages.flatMap((message) => message.parts).findLast((part) => part.type === "data-advice");
  const latestReadIndex = messages.findLastIndex((message) => message.parts.some((part) => part === latestRead));
  const lastAdviceIndex = messages.findLastIndex((message) => message.parts.some((part) => part === lastAdvice));
  const candidates = [...visible]
    .reverse()
    .filter((message) => message.role === "assistant")
    .flatMap((message) => {
      const hasV3 = message.parts.some((part) =>
        [
          "data-products",
          "data-categories",
          "data-comparison",
          "data-turnStatus",
          "data-shoppingState",
        ].includes(part.type),
      );
      return [...message.parts]
        .reverse()
        .filter(
          (part) =>
            part.type === "data-products" ||
            part.type === "data-comparison" ||
            part.type === "data-categories" ||
            (part.type === "data-shoppingState" &&
              ["new", "browse"].includes(
                part.data.transition?.operation ?? "",
              )) ||
            (!hasV3 &&
              part.type === "tool-searchProducts" &&
              part.state === "output-available"),
        );
    });
  const lastSearch =
    candidates.find(
      (part) =>
        part.type !== "data-products" || part.data.evidenceKind !== "selection",
    ) ?? candidates[0];
  const lastOutput =
    lastSearch?.type === "data-products"
      ? lastSearch.data
      : lastSearch && "output" in lastSearch
        ? lastSearch.output
        : undefined;
  const resultEnvelope =
    typeof lastOutput === "object" &&
    lastOutput !== null &&
    "products" in lastOutput &&
    Array.isArray(lastOutput.products)
      ? lastOutput
      : null;
  const resultIds =
    lastSearch?.type === "data-comparison"
      ? lastSearch.data.productIds
      : resultEnvelope && Array.isArray(resultEnvelope.products)
        ? resultEnvelope.products.flatMap((item: unknown) =>
            item &&
            typeof item === "object" &&
            "id" in item &&
            typeof item.id === "string"
              ? [item.id]
              : [],
          )
        : Array.isArray(lastOutput)
          ? lastOutput.flatMap((item: unknown) =>
              item &&
              typeof item === "object" &&
              "id" in item &&
              typeof item.id === "string"
                ? [item.id]
                : [],
            )
          : [];
  const resultNames = resultIds.flatMap((id) =>
    products
      .filter((product) => product.id === id)
      .map((product) => product.name),
  );
  const resultCount = resultNames.length;
  const remaining =
    resultEnvelope &&
    "remainingMatches" in resultEnvelope &&
    typeof resultEnvelope.remainingMatches === "number"
      ? resultEnvelope.remainingMatches
      : 0;
  return (
    <div className="assistant-workspace">
      <aside className="assistant-intro">
        <span className="eyebrow">AURELLE</span>
        <h1>Shopping assistant</h1>
        <p>
          All {products.length} products, prices, stock and policies are mock
          data.
        </p>
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
                {busy
                  ? "Working on your request…"
                  : "Products, prices and delivery"}
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
                    !isFailedMessage(message) &&
                    message.parts.some(
                      (p) => p.type === "text" && p.text.trim(),
                    ) && (
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
                  if (part.type === "text")
                    return isFailedMessage(message) ? null : (
                      <p key={i}>{part.text}</p>
                    );
                  if (part.type === "data-products")
                    return (
                      <ProductResults
                        key={i}
                        output={part.data}
                        evidence={part.data}
                      />
                    );
                  if (part.type === "data-categories")
                    return (
                      <CategoryResults
                        key={i}
                        categories={part.data}
                        disabled={
                          !ready || busy || conversationClosed
                        }
                        onSelect={(name) =>
                          send(`Show me products in category ${name}`, { type: "category", name })
                        }
                      />
                    );
                  if (part.type === "data-comparison")
                    return <ComparisonResults key={i} comparison={part.data} />;
                  if (part.type === "data-operation" && part.data.status === "needs-input" && part.data.kind === "cart" && part.data.input !== "quantity" && part.data.choices?.length && message.id === visible.at(-1)?.id) {
                    const choice = part.data;
                    return <div className="chat-followups" key={i} aria-label="Choose a product">
                      {choice.choices!.flatMap((id) => products.filter((product) => product.id === id)).map((product) => <button key={product.id} disabled={busy || conversationClosed} onClick={() => send(`Add ${choice.quantity ?? 1} × ${product.name} to my cart`, { type: "cart", productId: product.id, selection: "selected", quantity: choice.quantity ?? 1 })}>{choice.input ? `Add ${choice.quantity ?? 1} × ${product.name}` : product.name}</button>)}
                    </div>;
                  }
                  if (part.type === "data-advice") {
                    if (part !== message.parts.findLast((item) => item.type === "data-advice")) return null;
                    if (part.data.status === "included")
                      return assistantTextError(part.data.text, undefined, languages.get(message.id)) ? null : <p key={i}>{part.data.text}</p>;
                    if (part.data.status !== "unavailable") return null;
                    const operation = message.parts.findLast((item) => item.type === "data-operation");
                    const ownIndex = messages.findIndex((item) => item.id === message.id);
                    const priorRequest = messages.slice(0, ownIndex).findLast((item) => item.role === "user");
                    const target = priorRequest?.metadata?.shoppingAction?.type === "advice"
                      ? priorRequest.metadata.shoppingAction.operationId
                      : operation?.type === "data-operation" ? operation.data.id : undefined;
                    if (target && messages.slice(ownIndex + 1).some((item) => item.role === "user" && item.metadata?.shoppingAction?.type === "advice" && item.metadata.shoppingAction.operationId === target)) return null;
                    const seconds = Math.max(0, Math.ceil((Math.max(part.data.retryAt ?? 0, cooldown?.retryAt ?? 0) - clock) / 1000));
                    return <div className="chat-error" role="status" key={i}>
                      <p>{languages.get(message.id) === "pl" ? "Porada jest teraz niedostępna." : "Advice is unavailable right now."}</p>
                      {seconds > 0 && <p>{languages.get(message.id) === "pl" ? `Spróbuj ponownie za ${waitLabel(seconds)}.` : `Try again in ${waitLabel(seconds)}.`}</p>}
                      {target && !conversationClosed && <button disabled={busy || seconds > 0} onClick={() => send("Help me choose", { type: "advice", operationId: target })}>Retry advice</button>}
                    </div>;
                  }
                  if (part.type === "data-operation" && part.data.status === "failed" && !message.parts.some((item) => item.type === "data-turnStatus" && item.data.status !== "complete")) {
                    return <div className="chat-error" role="status" key={i}>
                      <p>{failureMessage(part.data.error)}</p>
                      {message.id === visible.at(-1)?.id && limited && <p>Retry in {waitLabel(retrySeconds)}.</p>}
                      {message.id === visible.at(-1)?.id && <button disabled={busy || limited} onClick={() => { if ((cooldown?.retryAt ?? 0) <= Date.now()) void regenerate(); }}>Retry last message</button>}
                    </div>;
                  }
                  if (
                    part.type === "data-turnStatus" &&
                    part.data.status !== "complete" && isFailedMessage(message)
                  ) {
                    if (
                      part !==
                      message.parts.findLast(
                        (item) =>
                          item.type === "data-turnStatus" &&
                          item.data.status !== "complete",
                      )
                    )
                      return null;
                    return (
                      <div className="chat-error" role="status" key={i}>
                        <p>{failureMessage(part.data)}</p>
                        {message.id === visible.at(-1)?.id && limited && (
                          <p>Retry in {waitLabel(retrySeconds)}.</p>
                        )}
                        {message.id === visible.at(-1)?.id && (
                          <button
                            disabled={busy || limited}
                            onClick={() => {
                              if ((cooldown?.retryAt ?? 0) <= Date.now())
                                void regenerate();
                            }}
                          >
                            Retry last message
                          </button>
                        )}
                      </div>
                    );
                  }
                  if (
                    !message.parts.some((p) =>
                      [
                        "data-products",
                        "data-categories",
                        "data-comparison",
                        "data-turnStatus",
                        "data-shoppingState",
                      ].includes(p.type),
                    ) &&
                    (part.type === "tool-searchProducts" ||
                      part.type === "tool-getProductDetails" ||
                      part.type === "tool-compareProducts") &&
                    part.state === "output-available"
                  )
                    return <ProductResults key={i} output={part.output} />;
                  return null;
                })}
              </article>
            ))
          )}
          {cartFeedback.map(({ action, status }) => {
            const pl = languages.get(action.userMessageId) === "pl";
            const effectiveStatus =
              status === "added" || status === "duplicate"
                ? status
                : (cartRetryStatus[action.operationId] ?? status);
            const items = action.items ?? [
              { productId: action.productId, quantity: action.quantity },
            ];
            return (
              <div
                className="chat-cart-feedback"
                role="status"
                key={action.operationId}
              >
                {effectiveStatus === "added" ||
                effectiveStatus === "duplicate" ? (
                  <>
                    {effectiveStatus === "added" && items.length > 1 ? (
                      <>
                        <p>{pl ? "Dodano do koszyka:" : "Added to your cart:"}</p>
                        <ul>
                          {items.map((item) => (
                            <li key={item.productId}>
                              {item.quantity} ×{" "}
                              {products.find(
                                (product) => product.id === item.productId,
                              )?.name ?? "Product"}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p>
                        {effectiveStatus === "added"
                          ? pl ? `Dodano do koszyka: ${items[0].quantity} × ${products.find((product) => product.id === items[0].productId)?.name ?? "produkt"}.` : `Added ${items[0].quantity} × ${products.find((product) => product.id === items[0].productId)?.name ?? "product"} to your cart.`
                          : pl ? "Ta prośba została już wykonana." : "This request was already processed."}
                      </p>
                    )}
                    <Link href="/cart">Open cart ↗</Link>
                  </>
                ) : (
                  <>
                    <p>
                      {effectiveStatus === "limit"
                        ? pl ? "W koszyku nie może być więcej niż 99 sztuk tego produktu." : "The cart cannot hold more than 99 of this item."
                        : effectiveStatus === "unavailable"
                          ? pl ? "Ten produkt jest niedostępny i nie został dodany." : "This item is unavailable and was not added."
                          : pl ? "Nie udało się zapisać koszyka. Produkt nie został dodany. Spróbuj ponownie." : "The cart could not be saved, so this item was not added. Please try again."}
                    </p>
                    {(effectiveStatus === "storage-error" ||
                      effectiveStatus === "not-ready") && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !retryAllowed.current ||
                            !messages.some(
                              (message) =>
                                message.role === "user" &&
                                message.id === action.userMessageId,
                            )
                          )
                            return;
                          const result = applyAction(action, conversationId);
                          setCartRetryStatus((previous) => ({
                            ...previous,
                            [action.operationId]: result,
                          }));
                        }}
                      >
                        Retry adding to cart
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {resultCount > 0 &&
            !busy &&
            !conversationClosed &&
            !latestFailed && (
              <div
                className="chat-followups"
                aria-label="Suggested follow-up questions"
              >
                {resultCount > 1 && (
                  <button
                    onClick={() =>
                      send(`Compare ${resultNames.join(", ")}`, {
                        type: "compare",
                        productIds: resultIds,
                      })
                    }
                  >
                    Compare these
                  </button>
                )}
                {remaining > 0 && (
                  <button onClick={() => send("Show me other options", { type: "more" })}>
                    Show other options
                  </button>
                )}
                <button
                  onClick={() =>
                    send(`Tell me more about ${resultNames[0]}`, {
                      type: "details",
                      productId: resultIds[0],
                    })
                  }
                >
                  More details
                </button>
                <button
                  onClick={() => send(`Add ${resultNames[0]} to my cart`, { type: "cart", productId: resultIds[0], selection: "selected", quantity: 1 })}
                >
                  Add the first to cart
                </button>
              </div>
            )}
          {latestRead?.type === "data-operation" && !(lastAdviceIndex >= latestReadIndex && lastAdvice?.type === "data-advice" && lastAdvice.data.status === "unavailable") && !busy && !conversationClosed && !latestFailed && (
            <div className="chat-followups" aria-label="Advice">
              <button disabled={limited} onClick={() => send(latestRead.data.kind === "comparison" ? "Explain differences" : "Help me choose", { type: "advice", operationId: latestRead.data.id })}>
                {latestRead.data.kind === "comparison" ? "Explain differences" : "Help me choose"}
              </button>
            </div>
          )}
          {!started && ready && (
            <div className="chat-starters" aria-label="Conversation starters">
              {shoppingStarters.map((s) => (
                <button
                  key={s.label}
                  onClick={() => send(s.text, s.action)}
                  disabled={busy || conversationClosed}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {busy && (
            <div className="chat-progress" role="status">
              <span className="progress-dots" aria-hidden="true">
                •••
              </span>
              {progress
                ? progressLabels[progress.phase]
                : status === "submitted"
                  ? "Thinking about your request…"
                  : "Putting your response together…"}
            </div>
          )}
          {error && !latestTypedFailure && !latestCompleted && (
            <div role="alert" className="chat-error">
              <strong>Let's try that again.</strong>
              <p>
                {failureMessage(httpFailure ?? { status: "connection-error" })}
              </p>
              {limited && <p>Retry in {waitLabel(retrySeconds)}.</p>}
              <button
                disabled={busy || limited}
                onClick={() => {
                  if ((cooldown?.retryAt ?? 0) > Date.now()) return;
                  nearBottom.current = true;
                  threadPosition.current.follow = true;
                  void regenerate();
                }}
              >
                Retry last message
              </button>
            </div>
          )}
          {unanswered && !error && !limited && ready && !conversationClosed && (
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
            <p>Start a new conversation to continue. Your cart stays saved.</p>
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
                disabled={
                  !ready || conversationClosed || !draft.trim()
                }
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
      <section className="demo-capabilities" aria-label="Shopping examples">
        <h2>Explore with the assistant</h2>
        <div className="capability-grid">
          {shoppingExamples.map(({ label, text, action }) => (
            <button
              key={label}
              disabled={!ready || busy || conversationClosed}
              onClick={() => {
                send(text, action);
                thread.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <p className="muted">
          Chat and cart are saved on this device.{" "}
          <Link href="https://github.com/MichalSalek/ecommerce-agent-ai">
            How it works ↗
          </Link>
        </p>
      </section>
    </div>
  );
}
