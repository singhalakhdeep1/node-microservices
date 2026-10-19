'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, avatarUrl, getToken, API_URL, type Notification } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function ProfilePage() {
  const { user, ready, refreshUser } = useApp();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [bust, setBust] = useState('');
  const [notes, setNotes] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const loadNotes = () =>
    api<{ data: { notifications: Notification[]; unread: number } }>('/api/notifications')
      .then((r) => {
        setNotes(r.data.notifications);
        setUnread(r.data.unread);
      })
      .catch(() => undefined);

  useEffect(() => {
    if (user) {
      setName(user.name);
      void loadNotes();
    }
  }, [user]);

  if (ready && !user) return <p>Please <Link href="/login">log in</Link>.</p>;
  if (!user) return null;

  return (
    <>
      <h1>Profile</h1>
      <div className="card row" style={{ gap: 16 }}>
        {user.hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar" src={avatarUrl(user.id, bust)} alt="Avatar" />
        ) : (
          <div className="avatar" aria-label="No avatar" />
        )}
        <div>
          <div><b>{user.email}</b> <span className="badge">{user.role}</span></div>
          <label className="muted">
            Upload avatar (PNG/JPEG/GIF/WebP, max 2 MB):{' '}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              aria-label="Avatar file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append('avatar', file);
                const res = await fetch(`${API_URL}/api/users/me/avatar`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: form });
                const body = await res.json();
                if (!res.ok) setError(body.error);
                else {
                  setMsg('Avatar updated');
                  setError('');
                  setBust(String(Date.now()));
                  await refreshUser();
                }
              }}
            />
          </label>
        </div>
      </div>

      <h2>Details</h2>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/api/users/me', { method: 'PATCH', json: { name } });
            await refreshUser();
            setMsg('Profile saved');
            setError('');
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Save</button>
      </form>
      {msg && <p className="success">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <h2>
        Notifications {unread > 0 && <span className="badge">{unread} unread</span>}
      </h2>
      {notes.length === 0 && <p className="muted">No notifications yet. They arrive from RabbitMQ events (registration, orders, stock alerts).</p>}
      {notes.length > 0 && (
        <button className="secondary" onClick={async () => { await api('/api/notifications/read-all', { method: 'POST' }); await loadNotes(); }}>
          Mark all read
        </button>
      )}
      {notes.map((n) => (
        <div className="card" key={n.id} style={{ marginTop: 8, opacity: n.read ? 0.7 : 1 }}>
          <div className="row spread">
            <b>{n.subject}</b>
            <span className={`badge ${n.status}`}>{n.status}</span>
          </div>
          <p className="muted" style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
          <span className="muted">{n.eventType} · {new Date(n.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </>
  );
}
