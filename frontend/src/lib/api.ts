// Typed client for the API gateway. Every call goes through the gateway; services are never called directly.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  hasAvatar: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  imageUrl?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  userId: string;
  customer: { name: string; email: string };
  items: OrderItem[];
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'failed';
  failureReason?: string;
  shippingAddress?: Record<string, string>;
  saga: { step: string; status: string; detail?: string; at: string }[];
  createdAt: string;
}

export interface Notification {
  id: string;
  eventType: string;
  subject: string;
  body: string;
  status: string;
  read: boolean;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const TOKEN_KEY = 'nms.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
  }
  return body as T;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
export const avatarUrl = (userId: string, bust = '') => `${API_URL}/api/users/${userId}/avatar${bust ? `?v=${bust}` : ''}`;
