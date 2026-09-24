import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Theme } from '@carbon/react';
import { ToastProvider, useToast } from './toast.js';
import type { ToastApi } from './toast.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderToasts(props: { defaultTimeoutMs?: number; lowContrast?: boolean } = {}) {
  let api!: ToastApi;
  function Grab() {
    api = useToast();
    return null;
  }
  const utils = render(
    <Theme theme="g100">
      <ToastProvider {...props}>
        <Grab />
      </ToastProvider>
    </Theme>
  );
  return { ...utils, api: () => api };
}

const stack = () => document.body.querySelector('.canopy-toasts');
const toastCount = () => document.body.querySelectorAll('.cds--toast-notification').length;

describe('ToastProvider / useToast', () => {
  it('shows a toast portaled to <body> with title, subtitle and caption', () => {
    const { api, container } = renderToasts();
    act(() => {
      api().show({ kind: 'success', title: 'Saved', subtitle: 'Routine saved', caption: 'now' });
    });
    expect(screen.getByText('Saved')).toBeDefined();
    expect(screen.getByText('Routine saved')).toBeDefined();
    expect(screen.getByText('now')).toBeDefined();
    const toast = screen.getByText('Saved').closest('.cds--toast-notification')!;
    expect(toast.classList.contains('cds--toast-notification--success')).toBe(true);
    // Portaled outside the render container, into the themed stack.
    expect(container.contains(toast)).toBe(false);
    expect(stack()?.contains(toast)).toBe(true);
    expect(stack()?.classList.contains('cds--g100')).toBe(true);
  });

  it('renders both live regions, empty, before the first toast', () => {
    renderToasts();
    expect(toastCount()).toBe(0);
    const alert = document.body.querySelector('.canopy-toasts [role="alert"]');
    const status = document.body.querySelector('.canopy-toasts [role="status"]');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    // Only additions are read, not the whole stack again.
    expect(alert?.getAttribute('aria-atomic')).toBe('false');
    expect(status?.getAttribute('aria-atomic')).toBe('false');
    expect(alert?.childElementCount).toBe(0);
    expect(status?.childElementCount).toBe(0);
  });

  it('puts errors in the assertive region and the other kinds in the polite one', () => {
    const { api } = renderToasts();
    const alert = document.body.querySelector('.canopy-toasts [role="alert"]')!;
    const status = document.body.querySelector('.canopy-toasts [role="status"]')!;
    act(() => {
      api().show({ kind: 'info', title: 'Note' });
      api().show({ kind: 'error', title: 'Failed' });
    });
    // The same region elements, now holding the toasts (so they are announced).
    expect(alert.isConnected && status.isConnected).toBe(true);
    expect(alert.textContent).toContain('Failed');
    expect(alert.textContent).not.toContain('Note');
    expect(status.textContent).toContain('Note');
    // The toasts themselves are not a second live region.
    for (const toast of document.body.querySelectorAll('.cds--toast-notification')) {
      expect(toast.getAttribute('aria-live')).toBe('off');
    }
    // Errors stack above the other kinds.
    const titles = [...document.body.querySelectorAll('.cds--toast-notification__title')].map(
      (e) => e.textContent
    );
    expect(titles).toEqual(['Failed', 'Note']);
  });

  it('stacks toasts in order and returns distinct ids', () => {
    const { api } = renderToasts();
    let a = '';
    let b = '';
    act(() => {
      a = api().show({ kind: 'info', title: 'First' });
      b = api().show({ kind: 'warning', title: 'Second' });
    });
    expect(a).not.toBe(b);
    const titles = [...document.body.querySelectorAll('.cds--toast-notification__title')].map(
      (e) => e.textContent
    );
    expect(titles).toEqual(['First', 'Second']);
  });

  it('auto-dismisses after 5000 ms by default', () => {
    const { api } = renderToasts();
    act(() => {
      api().show({ kind: 'info', title: 'Hello' });
    });
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.queryByText('Hello')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Hello')).toBeNull();
    expect(toastCount()).toBe(0);
    // The (empty) regions stay mounted for the next toast.
    expect(stack()).not.toBeNull();
  });

  it('keeps error toasts until dismissed, unless they set a timeout', () => {
    const { api } = renderToasts({ defaultTimeoutMs: 1000 });
    act(() => {
      api().show({ kind: 'error', title: 'Sticky error' });
      api().show({ kind: 'error', title: 'Timed error', timeoutMs: 2000 });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Timed error')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Sticky error')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(screen.queryByText('Sticky error')).toBeNull();
  });

  it('dismisses on time under StrictMode, even for a toast shown while mounting', () => {
    let api!: ToastApi;
    function ShowOnMount() {
      api = useToast();
      const { show } = api;
      useEffect(() => {
        show({ kind: 'info', title: 'Welcome' });
      }, [show]);
      return null;
    }
    render(
      <StrictMode>
        <ToastProvider>
          <ShowOnMount />
        </ToastProvider>
      </StrictMode>
    );
    // StrictMode runs the mount effect twice, so there are two.
    expect(screen.getAllByText('Welcome')).toHaveLength(2);
    act(() => {
      api.show({ kind: 'success', title: 'Later' });
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Welcome')).toBeNull();
    expect(screen.queryByText('Later')).toBeNull();
  });

  it('honours per-toast and provider timeouts; 0 is sticky', () => {
    const { api } = renderToasts({ defaultTimeoutMs: 1000 });
    act(() => {
      api().show({ kind: 'info', title: 'Provider default' });
      api().show({ kind: 'info', title: 'Custom', timeoutMs: 3000 });
      api().show({ kind: 'error', title: 'Sticky', timeoutMs: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Provider default')).toBeNull();
    expect(screen.queryByText('Custom')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Custom')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Sticky')).not.toBeNull();
  });

  it('dismiss(id) removes a toast early and ignores unknown ids', () => {
    const { api } = renderToasts();
    let id = '';
    act(() => {
      id = api().show({ kind: 'info', title: 'Bye', timeoutMs: 0 });
      api().show({ kind: 'info', title: 'Stay', timeoutMs: 0 });
    });
    act(() => {
      api().dismiss(id);
      api().dismiss('nope');
    });
    expect(screen.queryByText('Bye')).toBeNull();
    expect(screen.queryByText('Stay')).not.toBeNull();
  });

  it('the close button dismisses the toast', () => {
    const { api } = renderToasts();
    act(() => {
      api().show({ kind: 'info', title: 'Closable', timeoutMs: 0 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(screen.queryByText('Closable')).toBeNull();
  });

  it('is high contrast by default and low contrast on request', () => {
    const first = renderToasts();
    act(() => {
      first.api().show({ kind: 'info', title: 'A', timeoutMs: 0 });
    });
    expect(document.body.querySelector('.cds--toast-notification--low-contrast')).toBeNull();
    cleanup();

    const second = renderToasts({ lowContrast: true });
    act(() => {
      second.api().show({ kind: 'info', title: 'B', timeoutMs: 0 });
    });
    expect(document.body.querySelector('.cds--toast-notification--low-contrast')).not.toBeNull();
  });

  it('keeps a stable api across renders', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );
    const { result, rerender } = renderHook(() => useToast(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
  });
});
