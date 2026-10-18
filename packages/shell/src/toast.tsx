import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Theme, ToastNotification, useTheme } from '@carbon/react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  kind: ToastKind;
  title: string;
  subtitle?: string;
  caption?: string;
  /**
   * Auto-dismiss delay in ms; 0 = sticky. Default: sticky for `error`
   * toasts, which stay until the user closes them (or `dismiss(id)`), and
   * the provider's `defaultTimeoutMs` (5000) for the other kinds.
   */
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
  /**
   * Timeout for non-error toasts that don't set `timeoutMs`. Default 5000;
   * 0 = sticky. Error toasts are sticky unless they set `timeoutMs`.
   */
  defaultTimeoutMs?: number;
  /** Use Carbon's low-contrast (theme-following) toasts instead of the high-contrast default. */
  lowContrast?: boolean;
}

interface ToastEntry extends ToastOptions {
  id: string;
  /** Resolved auto-dismiss delay; 0 = sticky. */
  timeoutMs: number;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextToastId = 0;

interface ToastItemProps {
  toast: ToastEntry;
  lowContrast: boolean;
  dismiss: (id: string) => void;
}

/**
 * One toast. It owns its auto-dismiss timer, armed in an effect, so a
 * remount (React StrictMode, Fast Refresh) re-arms the timer instead of
 * losing it.
 */
function ToastItem({ toast, lowContrast, dismiss }: ToastItemProps) {
  const { id, timeoutMs } = toast;
  useEffect(() => {
    if (timeoutMs <= 0) return;
    const timer = setTimeout(() => dismiss(id), timeoutMs);
    return () => clearTimeout(timer);
  }, [id, timeoutMs, dismiss]);

  return (
    <ToastNotification
      kind={toast.kind}
      title={toast.title}
      subtitle={toast.subtitle}
      caption={toast.caption}
      // The surrounding region announces the toast; the toast itself is not a
      // second live region (which could read it twice).
      role="status"
      aria-live="off"
      aria-label="Close notification"
      lowContrast={lowContrast}
      onClose={() => {
        dismiss(id);
        // The provider owns removal; keep Carbon from also hiding it internally.
        return false;
      }}
    />
  );
}

/**
 * Stacked Carbon ToastNotifications, portaled to <body> and pinned top-right
 * under the header. Render it inside the app's <ColorModeTheme> so the toasts
 * pick up the page theme.
 *
 * The stack's live regions are rendered, empty, from the provider's first
 * render, so screen readers already watch them when a toast arrives: errors
 * go into an assertive `role="alert"` region, the other kinds into a polite
 * `role="status"` one. Errors stack above the other kinds.
 */
export function ToastProvider({
  children,
  defaultTimeoutMs = 5000,
  lowContrast = false,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const { theme } = useTheme();

  const dismiss = useCallback((id: string) => {
    setToasts((list) => (list.some((t) => t.id === id) ? list.filter((t) => t.id !== id) : list));
  }, []);

  const show = useCallback(
    (toast: ToastOptions) => {
      nextToastId += 1;
      const id = `canopy-toast-${nextToastId}`;
      const timeoutMs = toast.timeoutMs ?? (toast.kind === 'error' ? 0 : defaultTimeoutMs);
      setToasts((list) => [...list, { ...toast, id, timeoutMs }]);
      return id;
    },
    [defaultTimeoutMs]
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const toastsOf = (errors: boolean) =>
    toasts
      .filter((t) => (t.kind === 'error') === errors)
      .map((t) => <ToastItem key={t.id} toast={t} lowContrast={lowContrast} dismiss={dismiss} />);

  // Rendered even when empty: a live region that appears together with its
  // first message is often not announced.
  const stack = (
    <Theme theme={theme} className="canopy-toasts">
      <div className="canopy-toasts__region" role="alert" aria-live="assertive" aria-atomic="false">
        {toastsOf(true)}
      </div>
      <div className="canopy-toasts__region" role="status" aria-live="polite" aria-atomic="false">
        {toastsOf(false)}
      </div>
    </Theme>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' ? createPortal(stack, document.body) : null}
    </ToastContext.Provider>
  );
}

/** `{ show, dismiss }` for the nearest ToastProvider. Throws outside one. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>');
  return api;
}
