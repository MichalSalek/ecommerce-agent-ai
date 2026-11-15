"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { products } from "@/data/products";
import {
  addToCart,
  emptyCart,
  restoreCart,
  setQuantity,
  type Cart,
} from "@/domain/cart/cart";
import type { CartAction } from "@/application/chat/cart-action";
const KEY = "aurelle.cart.v1";
export type ActionResult =
  | "added"
  | "duplicate"
  | "unavailable"
  | "limit"
  | "storage-error"
  | "not-ready";
interface CartContextValue {
  cart: Cart;
  ready: boolean;
  storageError: boolean;
  update: (id: string, quantity: number) => void;
  add: (id: string) => ActionResult;
  applyAction: (action: CartAction, conversationId: string) => ActionResult;
}
const Context = createContext<CartContextValue | null>(null);
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState(emptyCart);
  const cartRef = useRef(cart);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  function publish(next: Cart) {
    cartRef.current = next;
    setCart(next);
  }
  useEffect(() => {
    try {
      publish(restoreCart(localStorage.getItem(KEY), products));
    } catch {
      setStorageError(true);
    }
    readyRef.current = true;
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null)
        publish(restoreCart(event.newValue, products));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function save(next: Cart, requireStorage: boolean): boolean {
    try {
      // One write commits both the cart and the replay ledger.
      localStorage.setItem(KEY, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
      if (requireStorage) return false;
    }
    publish(next);
    return true;
  }
  const update = (id: string, quantity: number) => {
    if (readyRef.current)
      save(setQuantity(cartRef.current, id, quantity, products), false);
  };
  const add = (id: string): ActionResult => {
    if (!readyRef.current) return "not-ready";
    const result = addToCart(cartRef.current, id, 1, products);
    if (result.status !== "added") return result.status;
    return save(result.cart, true) ? "added" : "storage-error";
  };
  const applyAction = (
    action: CartAction,
    conversationId: string,
  ): ActionResult => {
    if (!readyRef.current) return "not-ready";
    const result = addToCart(
      cartRef.current,
      action.productId,
      action.quantity,
      products,
      action.operationId,
    );
    if (result.status !== "added") return result.status;
    const next = {
      ...result.cart,
      receipts: [...result.cart.receipts, { ...action, conversationId }],
    };
    return save(next, true) ? "added" : "storage-error";
  };
  return (
    <Context.Provider
      value={{ cart, ready, storageError, update, add, applyAction }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const context = useContext(Context);
  if (!context) throw new Error("CartProvider is missing.");
  return context;
}
