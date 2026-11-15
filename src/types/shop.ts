import type { UIMessage } from "ai";
import type { CartAction } from "@/application/chat/cart-action";
export type { Product } from "@/domain/catalog/product";
export type ChatMessage = UIMessage<unknown, { cartAction: CartAction }>;
