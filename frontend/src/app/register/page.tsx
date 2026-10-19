'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function RegisterPage() {
  const { register } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <>
      <h1>Create an account</h1>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await register(name, email, password);
            router.push('/');
          } catch (err) {
            const details = err instanceof ApiError && err.details ? Object.values(err.details as Record<string, string[]>).flat().join(' ') : '';
            setError(`${(err as Error).message}${details ? `: ${details}` : ''}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input type="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password (min 8 characters)" aria-label="Password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy}>Register</button>
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}
