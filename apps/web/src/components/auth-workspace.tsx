'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function ProductBrand({ linked = false }: { linked?: boolean }) {
  const brand = <><span className="brand-mark">F</span> Finance<span>CRM</span></>;
  return linked
    ? <Link className="brand" href="/login" aria-label="Finance CRM đăng nhập">{brand}</Link>
    : <div className="brand" aria-label="Finance CRM">{brand}</div>;
}

export function LoginWorkspace({
  username,
  password,
  busy,
  error,
  notice,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string;
  password: string;
  busy: boolean;
  error: string;
  notice: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="login-layout">
      <section className="login-story">
        <ProductBrand linked />
        <div className="story-copy">
          <p className="eyebrow">WORKSPACE · CRM</p>
          <h1>Chăm sóc khách hàng, rõ ràng từ lần liên hệ đầu tiên.</h1>
          <p>Một không gian làm việc an toàn cho đội ngũ tư vấn và quản lý.</p>
        </div>
        <div className="story-foot"><span className="pulse" /> Cổng nội bộ · Finance CRM</div>
        <div className="decor decor-one" /><div className="decor decor-two" />
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <Card className="login-card">
          <CardContent className="login-card-content">
            <div className="mobile-brand"><ProductBrand /></div>
            <p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p>
            <h2 id="login-title">Đăng nhập</h2>
            <p className="form-intro">Nhập thông tin tài khoản nhân viên của bạn.</p>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {notice && <div className="alert alert-success" role="status">{notice}</div>}
            <form onSubmit={onSubmit} className="form-stack">
              <label htmlFor="username">Tên đăng nhập</label>
              <Input id="username" name="username" autoComplete="username" value={username} onChange={(event) => onUsernameChange(event.target.value)} className="h-11" required autoFocus />
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-wrap">
                <Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => onPasswordChange(event.target.value)} className="h-11" required />
                <Button className="reveal-button" type="button" variant="ghost" size="icon-sm" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
              <Button className="w-full justify-between" type="submit" size="lg" disabled={busy}>
                {busy ? 'Đang xác thực…' : 'Đăng nhập'}<ArrowRight aria-hidden="true" />
              </Button>
            </form>
            <p className="secure-note"><KeyRound aria-hidden="true" /> Kết nối an toàn · Phiên làm việc được bảo vệ</p>
          </CardContent>
        </Card>
        <footer className="panel-footer">Finance CRM <span>•</span> Hỗ trợ tài khoản: liên hệ quản trị viên</footer>
      </section>
    </main>
  );
}

export function PasswordChangeWorkspace({
  passwordChangeRequired,
  currentPassword,
  newPassword,
  confirmPassword,
  busy,
  error,
  notice,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onLogout,
}: {
  passwordChangeRequired: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  busy: boolean;
  error: string;
  notice: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
}) {
  return (
    <main className="account-layout">
      <header className="account-topbar">
        <ProductBrand linked />
        <span className="session-label">Bảo mật tài khoản</span>
      </header>
      <Card className="change-card">
        <CardContent className="change-card-content">
          <div className="change-icon"><KeyRound aria-hidden="true" /></div>
          <p className="eyebrow">THIẾT LẬP BẢO MẬT</p>
          <h1>Đổi mật khẩu để tiếp tục</h1>
          <p className="form-intro">{passwordChangeRequired ? 'Tài khoản đang dùng mật khẩu tạm. Hãy chọn mật khẩu mới để bảo vệ phiên làm việc.' : 'Nhập mật khẩu hiện tại và chọn mật khẩu mới cho tài khoản của bạn.'}</p>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
          <form onSubmit={onSubmit} className="form-stack">
            <label htmlFor="current-password">Mật khẩu hiện tại</label>
            <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => onCurrentPasswordChange(event.target.value)} className="h-11" required />
            <label htmlFor="new-password">Mật khẩu mới</label>
            <Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} className="h-11" required />
            <small>Tối thiểu 12 ký tự.</small>
            <label htmlFor="confirm-password">Xác nhận mật khẩu mới</label>
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => onConfirmPasswordChange(event.target.value)} className="h-11" required />
            <Button className="w-full justify-between" type="submit" size="lg" disabled={busy}>
              {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}<ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <Button className="text-button" type="button" variant="ghost" onClick={onLogout} disabled={busy}>Đăng xuất</Button>
        </CardContent>
      </Card>
    </main>
  );
}
