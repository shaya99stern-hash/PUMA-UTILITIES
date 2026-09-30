'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from './button';
import { cx } from './util';

export type ToastTone = 'default' | 'success' | 'error' | 'warning' | 'info';

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms; 0 keeps it until dismissed. Default 4500 (7000 for errors). */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type ToastEntry = ToastOptions & { id: number; closing?: boolean };

type ToastApi = {
  toast: (options: ToastOptions | string) => number;
  success: (title: ReactNode, description?: ReactNode) => number;
  error: (title: ReactNode, description?: ReactNode) => number;
  info: (title: ReactNode, description?: ReactNode) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { default: Info, info: Info, success: CheckCircle2, error: XCircle, warning: AlertTriangle } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 180);
  }, []);

  const toast = useCallback(
    (input: ToastOptions | string) => {
      const options: ToastOptions = typeof input === 'string' ? { title: input } : input;
      seq.current += 1;
      const id = seq.current;
      setToasts((list) => [...list.slice(-3), { ...options, id }]);
      const duration = options.duration ?? (options.tone === 'error' ? 7000 : 4500);
      if (duration > 0) window.setTimeout(() => remove(id), duration);
      return id;
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
      info: (title, description) => toast({ title, description, tone: 'info' }),
      dismiss: remove,
    }),
    [toast, remove],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => {
          const tone = t.tone ?? 'default';
          const Icon = ICONS[tone];
          return (
            <div key={t.id} className={cx('ui-toast', `ui-toast--${tone}`)} role={tone === 'error' ? 'alert' : 'status'} data-state={t.closing ? 'closing' : 'open'}>
              <Icon className="ui-toast__icon" aria-hidden />
              <div className="ui-toast__content">
                <span className="ui-toast__title">{t.title}</span>
                {t.description && <span className="ui-toast__desc">{t.description}</span>}
              </div>
              {t.action && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ui-toast__action"
                  onClick={() => {
                    t.action?.onClick();
                    remove(t.id);
                  }}
                >
                  {t.action.label}
                </Button>
              )}
              <IconButton icon={X} label="Dismiss" size="sm" className="ui-toast__close" onClick={() => remove(t.id)} />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

const noop: ToastApi = {
  toast: () => 0,
  success: () => 0,
  error: () => 0,
  info: () => 0,
  dismiss: () => undefined,
};

/** `const toast = useToast(); toast.success('Saved')` */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

/** Alias so `Toast` can be imported by name; the provider renders toasts. */
export const Toast = ToastProvider;
