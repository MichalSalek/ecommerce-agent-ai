import type { UIMessage } from "ai";
import type { CartAction } from "@/application/chat/cart-action";
import type {
  TurnCheckpoint,
  SearchEvidence,
  CategoryCard,
  Comparison,
  TurnStatus,
} from "@/application/chat/shopping-v3";
export type { Product } from "@/domain/catalog/product";
export type ChatMessage = UIMessage<
  unknown,
  {
    cartAction: CartAction;
    shoppingState: TurnCheckpoint;
    products: SearchEvidence;
    categories: CategoryCard[];
    comparison: Comparison;
    turnStatus: TurnStatus;
  }
>;
