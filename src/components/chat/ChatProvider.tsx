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
  CHAT_STORAGE_KEY,
  restoreConversation,
  settledMessages,
  requestMessages,
  welcomeMessage,
  type ConversationSnapshot,
} from "@/application/chat/history";
type CartFeedback = { action: CartAction; status: string };
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
  const [transport] = useState(() => {
    const base = new DefaultChatTransport<ChatMessage>({
      api: "/api/chat",
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
              if (chunk.type === "data-cartAction")
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
        if (part.type !== "data-cartAction") return;
        const parsed = cartActionSchema.safeParse(part.data);
        if (
          !parsed.success ||
          !active.current ||
          chunkGenerations.current.get(part) !== active.current.generation ||
          parsed.data.userMessageId !== active.current.userMessageId ||
          id !== activeConversation.current
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
    latest.current = {
      version: 1,
      id: chat.id,
      messages: settledMessages(messages),
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
  }, [ready, chat.id, helpers.messages, helpers.status, draft]);
  const newConversation = async () => {
    active.current = null;
    generation.current++;
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
