"use client";
import { Chat, useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { conversationUsage } from "@/application/chat/conversation-limit";
import {
  cartActionSchema,
  type CartAction,
} from "@/application/chat/cart-action";
import { useCart } from "@/components/CartProvider";
import type { ChatMessage } from "@/types/shop";
import {
  chatProgressSchema,
  adviceSchema,
  turnStatusSchema,
  type ChatProgress,
  type TurnStatus,
} from "@/application/chat/shopping-v3";
import {
  CHAT_STORAGE_KEY,
  restoreConversation,
  settledMessages,
  requestMessages,
  welcomeMessage,
  type ConversationSnapshot,
} from "@/application/chat/history";
type CartFeedback = { action: CartAction; status: string };
const COOLDOWN_KEY = "aurelle.chat.cooldown.v1";
interface ConversationValue extends UseChatHelpers<ChatMessage> {
  draft: string;
  setDraft: (text: string) => void;
  ready: boolean;
  storageNotice: string;
  conversationClosed: boolean;
  remainingTurns: number;
  newConversation: () => Promise<void>;
  threadPosition: RefObject<{ top: number; follow: boolean }>;
  cartFeedback: CartFeedback[];
  progress: ChatProgress | null;
  httpFailure: TurnStatus | null;
  cooldown: TurnStatus | null;
}
const Context = createContext<ConversationValue | null>(null);
export function ChatProvider({ children }: { children: ReactNode }) {
  const { applyAction, cart } = useCart();
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const applyRef = useRef(applyAction);
  applyRef.current = applyAction;
  const activeConversation = useRef("aurelle-bootstrap");
  const generation = useRef(0);
  const active = useRef<{ generation: number; userMessageId: string } | null>(
    null,
  );
  const chunkGenerations = useRef(new WeakMap<object, number>());
  const [cartFeedback, setCartFeedback] = useState<CartFeedback[]>([]);
  const [progress, setProgress] = useState<ChatProgress | null>(null);
  const [httpFailure, setHttpFailure] = useState<TurnStatus | null>(null);
  const [cooldown, setCooldown] = useState<TurnStatus | null>(null);
  const cooldownRef = useRef<TurnStatus | null>(null);
  function rememberCooldown(status: TurnStatus) {
    const retryAt =
      status.retryAt ??
      (status.retryAfter && status.retryAfter > 0
        ? Math.ceil(Date.now() + status.retryAfter * 1000)
        : undefined);
    if (!retryAt || !Number.isSafeInteger(retryAt) || retryAt <= Date.now())
      return;
    if ((cooldownRef.current?.retryAt ?? 0) >= retryAt) return;
    const value = { ...status, retryAt };
    cooldownRef.current = value;
    setCooldown(value);
    try {
      localStorage.setItem(
        COOLDOWN_KEY,
        JSON.stringify({ version: 1, status: value }),
      );
    } catch {
      /* The active tab still retains the cooldown. */
    }
  }
  const [transport] = useState(() => {
    const base = new DefaultChatTransport<ChatMessage>({
      api: "/api/chat",
      fetch: async (input, init) => {
        const token = active.current?.generation;
        const response = await fetch(input, init);
        if (!response.ok && response.status === 429) {
          try {
            const body: unknown = await response.clone().json();
            if (
              !init?.signal?.aborted &&
              token &&
              active.current?.generation === token &&
              body &&
              typeof body === "object"
            ) {
              const value = body as Record<string, unknown>;
              const seconds = Number(response.headers.get("retry-after"));
              const retryAfter =
                typeof value.retryAfter === "number"
                  ? value.retryAfter
                  : Number.isFinite(seconds) && seconds > 0
                    ? seconds
                    : undefined;
              const parsed = turnStatusSchema.safeParse({
                status: "provider-limit",
                code:
                  value.code === "BUSY" || value.code === "REQUEST_LIMIT"
                    ? value.code
                    : undefined,
                message:
                  value.code === "BUSY" || value.code === "REQUEST_LIMIT"
                    ? typeof value.message === "string"
                      ? value.message
                      : typeof value.error === "string"
                        ? value.error
                        : undefined
                    : undefined,
                retryAfter,
                retryAt:
                  typeof value.retryAt === "number"
                    ? value.retryAt
                    : retryAfter
                      ? Date.now() + retryAfter * 1000
                      : undefined,
              });
              if (parsed.success) {
                setHttpFailure(parsed.data);
                rememberCooldown(parsed.data);
              }
            }
          } catch {
            /* SDK reports a generic error if the response is not valid JSON. */
          }
        }
        return response;
      },
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          messages: requestMessages(messages),
          contract: "shopping-v3",
          conversationId: id,
          cart: { lines: cartRef.current.lines },
        },
      }),
    });
    return {
      async sendMessages(options: Parameters<typeof base.sendMessages>[0]) {
        const token = ++generation.current;
        setProgress(null);
        setHttpFailure(null);
        const user = [...options.messages]
          .reverse()
          .find((m) => m.role === "user");
        active.current =
          options.chatId === activeConversation.current && user
            ? { generation: token, userMessageId: user.id }
            : null;
        const stream = await base.sendMessages(options);
        return stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (
                options.abortSignal?.aborted ||
                active.current?.generation !== token ||
                options.chatId !== activeConversation.current
              )
                return;
              if (
                chunk.type === "data-cartAction" ||
                chunk.type === "data-progress" ||
                chunk.type === "data-advice" ||
                chunk.type === "data-turnStatus"
              )
                chunkGenerations.current.set(chunk, token);
              controller.enqueue(chunk);
            },
          }),
        );
      },
      reconnectToStream: base.reconnectToStream.bind(base),
    };
  });
  function createConversation(
    id: string,
    messages: ChatMessage[] = [welcomeMessage()],
  ) {
    return new Chat<ChatMessage>({
      id,
      transport,
      messages,
      onData(part) {
        if (
          !active.current ||
          chunkGenerations.current.get(part) !== active.current.generation ||
          id !== activeConversation.current
        )
          return;
        if (part.type === "data-progress") {
          const parsed = chatProgressSchema.safeParse(part.data);
          if (parsed.success) setProgress(parsed.data);
          return;
        }
        if (part.type === "data-turnStatus") {
          const parsed = turnStatusSchema.safeParse(part.data);
          if (parsed.success && parsed.data.status !== "complete")
            rememberCooldown(parsed.data);
          return;
        }
        if (part.type === "data-advice") {
          const parsed = adviceSchema.safeParse(part.data);
          if (parsed.success && parsed.data.status === "unavailable" && parsed.data.retryAt)
            rememberCooldown({ status: "provider-limit", retryAt: parsed.data.retryAt });
          return;
        }
        if (part.type !== "data-cartAction") return;
        const parsed = cartActionSchema.safeParse(part.data);
        if (
          !parsed.success ||
          parsed.data.userMessageId !== active.current.userMessageId
        )
          return;
        const action = parsed.data;
        const status = applyRef.current(action, id);
        setCartFeedback((previous) => {
          const existing = previous.find(
            (item) => item.action.operationId === action.operationId,
          );
          if (existing && status === "duplicate") return previous;
          return [
            ...previous.filter(
              (item) => item.action.operationId !== action.operationId,
            ),
            { action, status },
          ];
        });
      },
    });
  }
  const [chat, setChat] = useState(() =>
    createConversation("aurelle-bootstrap"),
  );
  const helpers = useChat({ chat, throttle: 80 });
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const threadPosition = useRef({ top: 0, follow: true });
  const latest = useRef<ConversationSnapshot>({
    version: 1,
    id: chat.id,
    messages: [welcomeMessage()],
    draft: "",
  });
  useEffect(() => {
    try {
      const cooldownRaw = localStorage.getItem(COOLDOWN_KEY);
      if (cooldownRaw) {
        const stored: unknown = JSON.parse(cooldownRaw);
        const status =
          stored &&
          typeof stored === "object" &&
          "version" in stored &&
          stored.version === 1 &&
          "status" in stored
            ? turnStatusSchema.safeParse(stored.status)
            : undefined;
        if (
          status?.success &&
          status.data.retryAt &&
          status.data.retryAt > Date.now()
        ) {
          cooldownRef.current = status.data;
          setCooldown(status.data);
        } else localStorage.removeItem(COOLDOWN_KEY);
      }
    } catch {
      /* Ignore invalid or inaccessible optional cooldown storage. */
    }
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      const saved = restoreConversation(raw);
      activeConversation.current = saved?.id ?? crypto.randomUUID();
      setChat(createConversation(activeConversation.current, saved?.messages));
      setDraft(saved?.draft ?? "");
      if (raw && !saved)
        setStorageNotice(
          "Your previous conversation could not be restored. Start a new one below.",
        );
    } catch {
      setStorageNotice(
        "Conversation saving is unavailable. Keep this tab open to retain the chat.",
      );
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const messages =
      helpers.status === "streaming"
        ? helpers.messages.filter(
            (m, i) =>
              i !== helpers.messages.length - 1 || m.role !== "assistant",
          )
        : helpers.messages;
    // A pre-stream 429 has no assistant message from the SDK. Persist its typed
    // failure against this user turn so reload keeps the reason and retry path.
    const last = messages.at(-1);
    const savedMessages: ChatMessage[] = httpFailure && last?.role === "user" && last.id === active.current?.userMessageId
      ? [...messages, { id: `http-failure:${last.id}`.slice(0, 150), role: "assistant", parts: [{ type: "data-turnStatus", data: httpFailure }] }]
      : messages;
    latest.current = {
      version: 1,
      id: chat.id,
      messages: settledMessages(savedMessages),
      draft,
    };
    const save = () => {
      try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(latest.current));
      } catch {
        setStorageNotice(
          "Conversation saving is unavailable. Keep this tab open to retain the chat.",
        );
      }
    };
    const timer = setTimeout(save, 150);
    window.addEventListener("pagehide", save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [ready, chat.id, helpers.messages, helpers.status, draft, httpFailure]);
  const newConversation = async () => {
    active.current = null;
    generation.current++;
    setProgress(null);
    setHttpFailure(null);
    await helpers.stop();
    threadPosition.current = { top: 0, follow: true };
    const next = createConversation(crypto.randomUUID());
    activeConversation.current = next.id;
    setCartFeedback([]);
    latest.current = {
      version: 1,
      id: next.id,
      messages: [welcomeMessage()],
      draft: "",
    };
    setChat(next);
    setDraft("");
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(latest.current));
      setStorageNotice("");
    } catch {
      setStorageNotice(
        "Conversation saving is unavailable. Keep this tab open to retain the chat.",
      );
    }
  };
  return (
    <Context.Provider
      value={{
        ...helpers,
        stop: async () => {
          active.current = null;
          generation.current++;
          setProgress(null);
          await helpers.stop();
        },
        draft,
        setDraft,
        ready,
        storageNotice,
        conversationClosed: conversationUsage(helpers.messages).closed,
        remainingTurns: conversationUsage(helpers.messages).remaining,
        newConversation,
        threadPosition,
        progress,
        httpFailure,
        cooldown,
        cartFeedback: [
          ...cart.receipts
            .filter(
              (receipt) =>
                receipt.conversationId === chat.id &&
                helpers.messages.some(
                  (message) =>
                    message.role === "user" &&
                    message.id === receipt.userMessageId,
                ),
            )
            .map((receipt) => ({ action: receipt, status: "added" })),
          ...cartFeedback.filter(
            (feedback) =>
              !cart.receipts.some(
                (receipt) =>
                  receipt.operationId === feedback.action.operationId,
              ),
          ),
        ],
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useConversation() {
  const context = useContext(Context);
  if (!context) throw new Error("ChatProvider is missing.");
  return context;
}
