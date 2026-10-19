'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, money, type Order } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function CartPage() {
  const { cart, setQuantity, clearCart, user } = useApp();
  const router = useRouter();
  const [address, setAddress] = useState({ street: '', city: '', zipCode: '', country: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // One idempotency key per checkout attempt: a double click or retry cannot create two orders.
  const idemKey = useRef(crypto.randomUUID());
  const total = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);

  if (cart.length === 0) {
    return (
      <>
        <h1>Cart</h1>
        <p className="muted">Your cart is empty. <Link href="/">Browse the catalog</Link></p>
      </>
    );
  }

  return (
    <>
      <h1>Cart</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            {cart.map((l) => (
              <tr key={l.product.id}>
                <td>{l.product.name}</td>
                <td>{money(l.product.price)}</td>
                <td>
                  <input
                    type="number"
                    aria-label={`Quantity of ${l.product.name}`}
                    min={0}
                    max={l.product.stock}
                    value={l.quantity}
                    onChange={(e) => setQuantity(l.product.id, Number(e.target.value))}
                    style={{ width: 80 }}
                  />
                </td>
                <td>{money(l.product.price * l.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="price">Total: {money(total)}</p>

      <h2>Shipping address</h2>
      <div className="row">
        {(['street', 'city', 'zipCode', 'country'] as const).map((k) => (
          <input key={k} placeholder={k === 'zipCode' ? 'ZIP code' : k[0].toUpperCase() + k.slice(1)} aria-label={k} value={address[k]} onChange={(e) => setAddress({ ...address, [k]: e.target.value })} />
        ))}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        {user ? (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const res = await api<{ data: Order }>('/api/orders', {
                  method: 'POST',
                  headers: { 'idempotency-key': idemKey.current },
                  json: { items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), shippingAddress: address },
                });
                clearCart();
                idemKey.current = crypto.randomUUID();
                router.push(`/orders/${res.data.id}`);
              } catch (err) {
                setError((err as Error).message);
                idemKey.current = crypto.randomUUID();
              } finally {
                setBusy(false);
              }
            }}
          >
            Place order
          </button>
        ) : (
          <Link href="/login">Log in to check out</Link>
        )}
        <button className="secondary" onClick={clearCart}>Clear cart</button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
