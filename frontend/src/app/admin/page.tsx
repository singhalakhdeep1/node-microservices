'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, money, type Order, type Product, type User } from '@/lib/api';
import { useApp } from '@/lib/store';

type Tab = 'products' | 'orders' | 'users' | 'system';

interface GatewayStatus {
  breakers: { name: string; state: string; failures: number }[];
  registry: Record<string, { id: string; url: string; healthy: boolean; source: string }[]>;
  consul: boolean;
  tracing: boolean;
  logging: string;
}

const NEXT: Record<Order['status'], Order['status'][]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  failed: [],
};

const emptyProduct = { name: '', description: '', price: '', stock: '', category: '' };

export default function AdminPage() {
  const { user, ready } = useApp();
  const [tab, setTab] = useState<Tab>('products');
  const [error, setError] = useState('');

  if (ready && user?.role !== 'admin') return <p>Admin only. <Link href="/login">Log in</Link> with an admin account.</p>;
  if (!user) return null;

  return (
    <>
      <h1>Admin</h1>
      <div className="tabs">
        {(['products', 'orders', 'users', 'system'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setError(''); }}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {tab === 'products' && <ProductsAdmin onError={setError} />}
      {tab === 'orders' && <OrdersAdmin onError={setError} />}
      {tab === 'users' && <UsersAdmin onError={setError} />}
      {tab === 'system' && <SystemAdmin onError={setError} />}
    </>
  );
}

function ProductsAdmin({ onError }: { onError: (m: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyProduct);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ data: { products: Product[] } }>('/api/products?limit=100').then((r) => setProducts(r.data.products)).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(load, [load]);

  const save = async () => {
    const body = { name: form.name, description: form.description, price: Number(form.price), stock: Number(form.stock), category: form.category };
    try {
      if (editing) await api(`/api/products/${editing}`, { method: 'PUT', json: body });
      else await api('/api/products', { method: 'POST', json: body });
      setForm(emptyProduct);
      setEditing(null);
      onError('');
      load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{editing ? 'Edit product' : 'New product'}</h2>
        <div className="row">
          <input placeholder="Name" aria-label="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Category" aria-label="Product category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input placeholder="Price" aria-label="Product price" type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <input placeholder="Stock" aria-label="Product stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
        </div>
        <textarea placeholder="Description" aria-label="Product description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ marginTop: 8 }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={save}>{editing ? 'Save changes' : 'Create product'}</button>
          {editing && <button className="secondary" onClick={() => { setEditing(null); setForm(emptyProduct); }}>Cancel</button>}
        </div>
      </div>
      <h2>Products ({products.length})</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th /></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.category}</td>
                <td>{money(p.price)}</td>
                <td>{p.stock}</td>
                <td className="row">
                  <button className="secondary" onClick={() => { setEditing(p.id); setForm({ name: p.name, description: p.description, price: String(p.price), stock: String(p.stock), category: p.category }); }}>Edit</button>
                  <button className="danger" onClick={async () => { if (!confirm(`Delete ${p.name}?`)) return; try { await api(`/api/products/${p.id}`, { method: 'DELETE' }); load(); } catch (e) { onError((e as Error).message); } }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OrdersAdmin({ onError }: { onError: (m: string) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<{ status: string; count: number; revenue: number }[]>([]);
  const load = useCallback(() => {
    api<{ data: { orders: Order[] } }>('/api/orders?all=true&limit=100').then((r) => setOrders(r.data.orders)).catch((e) => onError(e.message));
    api<{ data: typeof stats }>('/api/orders/stats').then((r) => setStats(r.data)).catch(() => undefined);
  }, [onError]);
  useEffect(load, [load]);

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {stats.map((s) => (
          <div className="card" key={s.status}>
            <span className={`badge ${s.status}`}>{s.status}</span> <b>{s.count}</b> <span className="muted">{money(s.revenue)}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Change status</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/orders/${o.id}`}>{o.id.slice(-8)}</Link><div className="muted">{new Date(o.createdAt).toLocaleString()}</div></td>
                <td>{o.customer?.name}<div className="muted">{o.customer?.email}</div></td>
                <td>{money(o.totalAmount)}</td>
                <td><span className={`badge ${o.status}`}>{o.status}</span></td>
                <td className="row">
                  {NEXT[o.status].map((s) => (
                    <button key={s} className={s === 'cancelled' ? 'danger' : 'secondary'} onClick={async () => {
                      try {
                        await api(`/api/orders/${o.id}/status`, { method: 'PUT', json: { status: s } });
                        load();
                      } catch (e) {
                        onError((e as Error).message);
                      }
                    }}>{s}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsersAdmin({ onError }: { onError: (m: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const load = useCallback(() => {
    api<{ data: { users: User[] } }>('/api/users?limit=100').then((r) => setUsers(r.data.users)).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(load, [load]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td><span className="badge">{u.role}</span></td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <button className="secondary" onClick={async () => {
                  try {
                    await api(`/api/users/${u.id}/role`, { method: 'PATCH', json: { role: u.role === 'admin' ? 'user' : 'admin' } });
                    load();
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}>{u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemAdmin({ onError }: { onError: (m: string) => void }) {
  const [health, setHealth] = useState<{ status: string; dependencies: Record<string, string> } | null>(null);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const load = useCallback(() => {
    api<{ status: string; dependencies: Record<string, string> }>('/health').then(setHealth).catch((e) => onError(e.message));
    api<{ data: GatewayStatus }>('/api/gateway/status').then((r) => setStatus(r.data)).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <h2>Service health {health && <span className={`badge ${health.status}`}>{health.status}</span>}</h2>
      <div className="grid">
        {health && Object.entries(health.dependencies).map(([name, s]) => (
          <div className="card" key={name}><b>{name}</b> <span className={`badge ${s}`}>{s}</span></div>
        ))}
      </div>
      {status && (
        <>
          <h2>Circuit breakers</h2>
          {status.breakers.length === 0 && <p className="muted">No downstream calls yet.</p>}
          <div className="row">
            {status.breakers.map((b) => (
              <div className="card" key={b.name}><b>{b.name}</b> <span className={`badge ${b.state}`}>{b.state}</span> <span className="muted">{b.failures} failures</span></div>
            ))}
          </div>
          <h2>Service registry</h2>
          <p className="muted">Discovery: {status.consul ? 'Consul' : 'static URLs'} · Tracing: {status.tracing ? 'Zipkin' : 'off'} · Logs: {status.logging}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Instance</th><th>URL</th><th>Source</th><th>Healthy</th></tr></thead>
              <tbody>
                {Object.entries(status.registry).flatMap(([svc, list]) =>
                  list.map((i) => (
                    <tr key={i.id}>
                      <td>{svc}</td><td>{i.id}</td><td>{i.url}</td><td>{i.source}</td>
                      <td><span className={`badge ${i.healthy ? 'healthy' : 'unhealthy'}`}>{i.healthy ? 'yes' : 'no'}</span></td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
