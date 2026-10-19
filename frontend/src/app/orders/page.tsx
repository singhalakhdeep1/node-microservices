'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, money, type Order } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function OrdersPage() {
  const { user, ready } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api<{ data: { orders: Order[] } }>('/api/orders?limit=50')
      .then((r) => setOrders(r.data.orders))
      .catch((e) => setError(e.message));
  }, [user]);

  if (ready && !user) return <p>Please <Link href="/login">log in</Link> to see your orders.</p>;

  return (
    <>
      <h1>My orders</h1>
      {error && <p className="error">{error}</p>}
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      <div className="table-wrap">
        {orders.length > 0 && (
          <table>
            <thead>
              <tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/orders/${o.id}`}>{o.id.slice(-8)}</Link></td>
                  <td>{new Date(o.createdAt).toLocaleString()}</td>
                  <td>{o.items.map((i) => `${i.quantity} x ${i.productName}`).join(', ')}</td>
                  <td>{money(o.totalAmount)}</td>
                  <td><span className={`badge ${o.status}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
