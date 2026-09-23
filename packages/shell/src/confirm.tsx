import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '@carbon/react';

export interface ConfirmOptions {
  heading: string;
  /** A string is wrapped in a paragraph; anything else renders as-is. */
  body: ReactNode;
  /** Primary button text. Default 'Confirm'. */
  confirmLabel?: string;
  /** Secondary button text. Default 'Cancel'. */
  cancelLabel?: string;
  /**
   * Destructive action: red primary button, initial focus on Cancel, and Enter
   * never confirms implicitly (it only activates the focused button).
   */
  danger?: boolean;
  /** Carbon modal size. Default 'sm'. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/** Resolves true on confirm; false on cancel, Escape, the close button or an outside click. */
export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
  settled: boolean;
  returnFocus: HTMLElement | null;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export interface ConfirmProviderProps {
  children: ReactNode;
}

/**
 * Promise-returning confirmation dialogs (a Carbon Modal). Requests made while
 * a dialog is open queue up and are shown in order. Render it inside the app's
 * <ColorModeTheme> so the dialog picks up the page theme.
 */
export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const queueRef = useRef(queue);
  const focusAfterClose = useRef<HTMLElement | null>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        setQueue((q) => [
          ...q,
          {
            ...options,
            resolve,
            settled: false,
            returnFocus: active instanceof HTMLElement ? active : null,
          },
        ]);
      }),
    []
  );

  const settle = useCallback((request: ConfirmRequest, ok: boolean) => {
    // Carbon can report one key press twice (its Enter handler plus the native
    // button click); only the first answer counts.
    if (request.settled) return;
    request.settled = true;
    request.resolve(ok);
    focusAfterClose.current = request.returnFocus;
    setQueue((q) => q.filter((r) => r !== request));
  }, []);

  // Give focus back to whatever opened the dialog once it has unmounted.
  useEffect(() => {
    if (current || !focusAfterClose.current) return;
    const target = focusAfterClose.current;
    focusAfterClose.current = null;
    if (target.isConnected) target.focus();
  }, [current]);

  // Unmounting with dialogs pending answers them all with false.
  useEffect(
    () => () => {
      for (const request of queueRef.current) {
        if (!request.settled) {
          request.settled = true;
          request.resolve(false);
        }
      }
    },
    []
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <Modal
          open
          className="canopy-confirm"
          modalHeading={current.heading}
          primaryButtonText={current.confirmLabel ?? 'Confirm'}
          secondaryButtonText={current.cancelLabel ?? 'Cancel'}
          danger={current.danger}
          size={current.size ?? 'sm'}
          // Carbon focuses the primary button (Cancel when danger). Enter on a
          // focused button activates it; Enter elsewhere in the dialog confirms,
          // except for danger dialogs.
          shouldSubmitOnEnter={!current.danger}
          onRequestSubmit={() => settle(current, true)}
          onRequestClose={() => settle(current, false)}
        >
          {typeof current.body === 'string' ? (
            <p className="canopy-confirm__body">{current.body}</p>
          ) : (
            current.body
          )}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/** `confirm(options) => Promise<boolean>` for the nearest ConfirmProvider. Throws outside one. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() must be used inside <ConfirmProvider>');
  return confirm;
}
