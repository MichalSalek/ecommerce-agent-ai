import type { Metadata } from "next";
import ChatView from "@/components/chat/ChatView";
export const metadata: Metadata = { title: "Shopping assistant - Aurelle" };
export default function ChatPage() {
  return <ChatView />;
}
