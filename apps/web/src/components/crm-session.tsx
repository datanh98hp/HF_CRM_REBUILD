'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { request } from '@/lib/crm-api';

export type Session = { accessToken: string; passwordChangeRequired: boolean };
export type CapabilityNotice = { status: string; ready: boolean; messageVi: string };
export type Staff = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  type: string;
  mustChangePassword: boolean;
  roles: {
    key: string;
    name: string;
    scope: { branch?: { id: string; code: string; name: string }; global?: boolean };
  }[];
  permissions: { key: string; scopes: string[] }[];
};

type CrmSessionContextValue = {
  session: Session | null;
  staff: Staff | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  capabilities: { contractCompletionOtp: CapabilityNotice } | null;
  mustChangePassword: boolean;
  can: (permission: string) => boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  loadStaff: (token: string) => Promise<void>;
  login: (username: string, password: string) => Promise<Session>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
};

const CrmSessionContext = createContext<CrmSessionContextValue | null>(null);

export function CrmSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [capabilities, setCapabilities] = useState<{ contractCompletionOtp: CapabilityNotice } | null>(null);

  const loadStaff = useCallback(async (token: string) => {
    const profile = await request<Staff>('/auth/me', {}, token);
    setStaff(profile);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void request<Session>('/auth/refresh', { method: 'POST' })
      .then(async (nextSession) => {
        if (!active) return;
        setSession(nextSession);
        if (!nextSession.passwordChangeRequired) await loadStaff(nextSession.accessToken);
        else setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setStaff(null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [loadStaff]);

  useEffect(() => {
    let active = true;
    void request<{ contractCompletionOtp: CapabilityNotice }>('/capabilities')
      .then((value) => { if (active) setCapabilities(value); })
      .catch(() => { if (active) setCapabilities(null); });
    return () => { active = false; };
  }, []);

  const mustChangePassword = Boolean(session?.passwordChangeRequired || staff?.mustChangePassword);
  const can = useCallback(
    (permission: string) => Boolean(staff?.permissions.some((item) => item.key === permission)),
    [staff],
  );

  useEffect(() => {
    if (loading) return;
    if (!session) {
      if (pathname !== '/login') router.replace('/login');
      return;
    }
    if (mustChangePassword) {
      if (pathname !== '/change-password') router.replace('/change-password');
      return;
    }
    if (!staff) return;
    if (pathname === '/' || pathname === '/login') {
      router.replace('/profile');
    }
  }, [loading, mustChangePassword, pathname, router, session, staff]);

  const login = useCallback(async (username: string, password: string) => {
    const nextSession = await request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setSession(nextSession);
    setStaff(null);
    if (!nextSession.passwordChangeRequired) {
      try {
        await loadStaff(nextSession.accessToken);
      } catch (cause) {
        setSession(null);
        setStaff(null);
        throw cause;
      }
    } else setLoading(false);
    return nextSession;
  }, [loadStaff]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!session) throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    const updated = await request<Session>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }, session.accessToken);
    setSession(updated);
    try {
      await loadStaff(updated.accessToken);
    } catch (cause) {
      setSession(null);
      setStaff(null);
      throw cause;
    }
  }, [loadStaff, session]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      if (session) await request('/auth/logout', { method: 'POST' }, session.accessToken);
    } catch {
      // Local state still needs clearing when the server session has expired.
    } finally {
      setSession(null);
      setStaff(null);
      setBusy(false);
      setNotice('Bạn đã đăng xuất.');
      router.replace('/login');
    }
  }, [router, session]);

  const value = useMemo<CrmSessionContextValue>(() => ({
    session,
    staff,
    loading,
    busy,
    error,
    notice,
    capabilities,
    mustChangePassword,
    can,
    setBusy,
    setError,
    setNotice,
    loadStaff,
    login,
    changePassword,
    logout,
  }), [
    session,
    staff,
    loading,
    busy,
    error,
    notice,
    capabilities,
    mustChangePassword,
    can,
    loadStaff,
    login,
    changePassword,
    logout,
  ]);

  return <CrmSessionContext.Provider value={value}>{children}</CrmSessionContext.Provider>;
}

export function useCrmSession() {
  const context = useContext(CrmSessionContext);
  if (!context) throw new Error('useCrmSession must be used inside CrmSessionProvider.');
  return context;
}
