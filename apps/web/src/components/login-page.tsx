'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoginWorkspace } from '@/components/auth-workspace';
import { useCrmSession } from '@/components/crm-session';

export function LoginPage() {
  const router = useRouter();
  const { loading, busy, setBusy, setError, error, notice, login } = useCrmSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await login(username, password);
      setPassword('');
      router.replace(session.passwordChangeRequired ? '/change-password' : '/profile');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang khôi phục phiên làm việc…</p></main>;
  }

  return (
    <LoginWorkspace
      username={username}
      password={password}
      busy={busy}
      error={error}
      notice={notice}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={submit}
    />
  );
}
