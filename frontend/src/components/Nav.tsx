'use client';

import Link from 'next/link';
import { useApp } from '@/lib/store';

export function Nav() {
  const { user, cart, logout, ready } = useApp();
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  return (
    <header className="nav">
      <Link href="/" className="brand">Node Microservices Shop</Link>
      <Link href="/">Catalog</Link>
      <Link href="/cart">Cart ({count})</Link>
      {ready && user && <Link href="/orders">Orders</Link>}
      {ready && user && <Link href="/profile">Profile</Link>}
      {ready && user?.role === 'admin' && <Link href="/admin">Admin</Link>}
      {ready && !user && <Link href="/login">Log in</Link>}
      {ready && !user && <Link href="/register">Register</Link>}
      {ready && user && (
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      )}
    </header>
  );
}
