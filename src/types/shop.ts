import type { UIMessage } from "ai";
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  category: string;
  inStock: boolean;
}
export interface ToolInvocation {
  toolName: string;
  result?: Product[];
}
export interface ChatMessage extends UIMessage {}
