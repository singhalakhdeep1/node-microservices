'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, money, type Order } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const { user, ready } = useApp();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ data: Order }>(`/api/orders/${params.id}`)
      .then((r) => setOrder(r.data))
      .catch((e) => setError(e.message));
  }, [params.id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (ready && !user) return <p>Please <Link href="/login">log in</Link>.</p>;
  if (error && !order) return <p className="error">{error}</p>;
  if (!order) return <p className="muted">Loading...</p>;

  const cancellable = order.status === 'pending' || order.status === 'confirmed';
  return (
    <>
      <p><Link href="/orders">&larr; All orders</Link></p>
      <h1>
        Order {order.id.slice(-8)} <span className={`badge ${order.status}`}>{order.status}</span>
      </h1>
      {order.failureReason && <p className="error">{order.failureReason}</p>}
      <div className="card">
        {order.items.map((i) => (
          <div className="row spread" key={i.productId}>
            <span>{i.quantity} x {i.productName}</span>
            <span>{money(i.price * i.quantity)}</span>
          </div>
        ))}
        <hr />
        <div className="row spread price"><span>Total</span><span>{money(order.totalAmount)}</span></div>
        {order.shippingAddress && Object.values(order.shippingAddress).some(Boolean) && (
          <p className="muted">Ship to: {Object.values(order.shippingAddress).filter(Boolean).join(', ')}</p>
        )}
      </div>

      <h2>Saga log</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Step</th><th>Result</th><th>Detail</th><th>Time</th></tr></thead>
          <tbody>
            {order.saga.map((s, i) => (
              <tr key={i}>
                <td>{s.step}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td>{s.detail ?? ''}</td>
                <td>{new Date(s.at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cancellable && (
        <button
          className="danger"
          style={{ marginTop: 16 }}
          onClick={async () => {
            try {
              const r = await api<{ data: Order }>(`/api/orders/${order.id}/cancel`, { method: 'POST' });
              setOrder(r.data);
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Cancel order
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
