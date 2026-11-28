'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';

type ToastProps = {
  message: string;
  variant?: 'success' | 'error';
  action?: ReactNode;
  onDismiss?: () => void;
};

function Toast({ message, variant = 'success', action, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current?.();
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!visible) return null;
  const isError = variant === 'error';

  return (
    <div className={`fixed right-4 top-4 z-[100] w-[min(24rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-top-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${isError ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      <div className="flex items-start gap-2">
        {isError ? <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-700" /> : <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" />}
        <p className="min-w-0 flex-1">{message}</p>
        {action}
        <button type="button" onClick={() => { setVisible(false); onDismissRef.current?.(); }} aria-label="Đóng thông báo" className={`-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 ${isError ? 'text-red-800 hover:bg-red-100 focus-visible:outline-red-700' : 'text-emerald-800 hover:bg-emerald-100 focus-visible:outline-emerald-700'}`}>
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { Toast };
