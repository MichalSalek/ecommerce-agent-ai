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
import type { ChatMessage } from "@/types/shop";
import {
  CHAT_STORAGE_KEY,
  restoreConversation,
  settledMessages,
  requestMessages,
  welcomeMessage,
  type ConversationSnapshot,
} from "@/application/chat/history";
const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { messages: requestMessages(messages) },
  }),
});
function createConversation(
  id: string,
  messages: ChatMessage[] = [welcomeMessage()],
) {
  return new Chat<ChatMessage>({ id, transport, messages });
}
interface ConversationValue extends UseChatHelpers<ChatMessage> {
  draft: string;
  setDraft: (text: string) => void;
  ready: boolean;
  storageNotice: string;
  newConversation: () => Promise<void>;
  threadPosition: RefObject<{ top: number; follow: boolean }>;
}
const Context = createContext<ConversationValue | null>(null);
export function ChatProvider({ children }: { children: ReactNode }) {
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
      setChat(
        createConversation(saved?.id ?? crypto.randomUUID(), saved?.messages),
      );
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
    await helpers.stop();
    threadPosition.current = { top: 0, follow: true };
    const next = createConversation(crypto.randomUUID());
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
        draft,
        setDraft,
        ready,
        storageNotice,
        newConversation,
        threadPosition,
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
