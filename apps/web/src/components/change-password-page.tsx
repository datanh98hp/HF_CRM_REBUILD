'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PasswordChangeWorkspace } from '@/components/auth-workspace';
import { useCrmSession } from '@/components/crm-session';

export function ChangePasswordPage() {
  const router = useRouter();
  const {
    session,
    loading,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    changePassword,
    logout,
  } = useCrmSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword.length < 12) {
      setError('Mật khẩu mới cần có ít nhất 12 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận chưa khớp.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Mật khẩu đã được cập nhật.');
      router.replace('/profile');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đổi mật khẩu.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !session) {
    return <main className="loading-screen"><span className="spinner" aria-hidden="true" /><p>Đang khôi phục phiên làm việc…</p></main>;
  }

  return (
    <PasswordChangeWorkspace
      passwordChangeRequired={session.passwordChangeRequired}
      currentPassword={currentPassword}
      newPassword={newPassword}
      confirmPassword={confirmPassword}
      busy={busy}
      error={error}
      notice={notice}
      onCurrentPasswordChange={setCurrentPassword}
      onNewPasswordChange={setNewPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onSubmit={submit}
      onLogout={() => { void logout(); }}
    />
  );
}
