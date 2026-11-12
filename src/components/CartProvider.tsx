"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { products } from "@/data/products";
import {
  emptyCart,
  restoreCart,
  setQuantity,
  type Cart,
} from "@/domain/cart/cart";
const KEY = "aurelle.cart.v1";
interface CartContextValue {
  cart: Cart;
  ready: boolean;
  storageError: boolean;
  update: (id: string, quantity: number) => void;
  add: (id: string) => void;
}
const Context = createContext<CartContextValue | null>(null);
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState(emptyCart);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      setCart(restoreCart(localStorage.getItem(KEY), products));
    } catch {
      setStorageError(true);
    }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null)
        setCart(restoreCart(event.newValue, products));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [cart, ready]);
  const update = (id: string, quantity: number) =>
    setCart((previous) => setQuantity(previous, id, quantity, products));
  const add = (id: string) => {
    console.log("[CART] added product:", id);
    setCart((previous) =>
      setQuantity(
        previous,
        id,
        (previous.lines.find((l) => l.productId === id)?.quantity ?? 0) + 1,
        products,
      ),
    );
  };
  return (
    <Context.Provider value={{ cart, ready, storageError, update, add }}>
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const context = useContext(Context);
  if (!context) throw new Error("CartProvider is missing.");
  return context;
}
