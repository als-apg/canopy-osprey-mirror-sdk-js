import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Theme, ToastNotification, useTheme } from '@carbon/react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  kind: ToastKind;
  title: string;
  subtitle?: string;
  caption?: string;
  /** Auto-dismiss delay in ms. Default: the provider's `defaultTimeoutMs` (5000). 0 = sticky. */
  timeoutMs?: number;
}

export interface ToastApi {
  /** Show a toast; returns its id. */
  show(toast: ToastOptions): string;
  /** Remove a toast early (no-op for unknown ids). */
  dismiss(id: string): void;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Timeout for toasts that don't set `timeoutMs`. Default 5000; 0 = sticky. */
  defaultTimeoutMs?: number;
  /** Use Carbon's low-contrast (theme-following) toasts instead of the high-contrast default. */
  lowContrast?: boolean;
}

interface ToastEntry extends ToastOptions {
  id: string;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextToastId = 0;

/**
 * Stacked Carbon ToastNotifications, portaled to <body> and pinned top-right
 * under the header. Render it inside the app's <ColorModeTheme> so the toasts
 * pick up the page theme.
 */
export function ToastProvider({
  children,
  defaultTimeoutMs = 5000,
  lowContrast = false,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const { theme } = useTheme();

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => (list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list));
  }, []);

  const show = useCallback(
    (toast: ToastOptions) => {
      nextToastId += 1;
      const id = `canopy-toast-${nextToastId}`;
      setToasts((list) => [...list, { ...toast, id }]);
      const timeout = toast.timeoutMs ?? defaultTimeoutMs;
      if (timeout > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), timeout)
        );
      }
      return id;
    },
    [defaultTimeoutMs, dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const stack = (
    <Theme theme={theme} className="canopy-toasts">
      {toasts.map((t) => (
        <ToastNotification
          key={t.id}
          kind={t.kind}
          title={t.title}
          subtitle={t.subtitle}
          caption={t.caption}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-label="Close notification"
          lowContrast={lowContrast}
          onClose={() => {
            dismiss(t.id);
            // The provider owns removal; keep Carbon from also hiding it internally.
            return false;
          }}
        />
      ))}
    </Theme>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && toasts.length > 0
        ? createPortal(stack, document.body)
        : null}
    </ToastContext.Provider>
  );
}

/** `{ show, dismiss }` for the nearest ToastProvider. Throws outside one. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>');
  return api;
}
