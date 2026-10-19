'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type Product, type User } from './api';

export interface CartLine {
  product: Pick<Product, 'id' | 'name' | 'price' | 'stock'>;
  quantity: number;
}

interface AppState {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): void;
  refreshUser(): Promise<void>;
  cart: CartLine[];
  addToCart(p: Product, qty?: number): void;
  setQuantity(productId: string, qty: number): void;
  clearCart(): void;
}

const Ctx = createContext<AppState | null>(null);
const CART_KEY = 'nms.cart';

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const res = await api<{ data: User }>('/api/users/me');
      setUser(res.data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch {
      // ignore
    }
    refreshUser().finally(() => setReady(true));
  }, [refreshUser]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart]);

  const value = useMemo<AppState>(
    () => ({
      user,
      ready,
      async login(email, password) {
        const res = await api<{ token: string; data: User }>('/api/users/login', { method: 'POST', json: { email, password } });
        setToken(res.token);
        setUser(res.data);
      },
      async register(name, email, password) {
        const res = await api<{ token: string; data: User }>('/api/users/register', { method: 'POST', json: { name, email, password } });
        setToken(res.token);
        setUser(res.data);
      },
      logout() {
        setToken(null);
        setUser(null);
      },
      refreshUser,
      cart,
      addToCart(p, qty = 1) {
        setCart((lines) => {
          const existing = lines.find((l) => l.product.id === p.id);
          if (existing) return lines.map((l) => (l.product.id === p.id ? { ...l, quantity: Math.min(p.stock, l.quantity + qty) } : l));
          return [...lines, { product: { id: p.id, name: p.name, price: p.price, stock: p.stock }, quantity: Math.min(p.stock, qty) }];
        });
      },
      setQuantity(productId, qty) {
        setCart((lines) => (qty <= 0 ? lines.filter((l) => l.product.id !== productId) : lines.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l))));
      },
      clearCart() {
        setCart([]);
      },
    }),
    [user, ready, cart, refreshUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
