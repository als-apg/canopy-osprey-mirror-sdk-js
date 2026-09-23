import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
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

describe('ToastProvider / useToast', () => {
  it('shows a toast portaled to <body> with title, subtitle and caption', () => {
    const { api, container } = renderToasts();
    act(() => {
      api().show({ kind: 'success', title: 'Saved', subtitle: 'Routine saved', caption: 'now' });
    });
    expect(screen.getByText('Saved')).toBeDefined();
    expect(screen.getByText('Routine saved')).toBeDefined();
    expect(screen.getByText('now')).toBeDefined();
    const toast = screen.getByRole('status');
    expect(toast.classList.contains('cds--toast-notification--success')).toBe(true);
    // Portaled outside the render container, into the themed stack.
    expect(container.contains(toast)).toBe(false);
    expect(stack()?.contains(toast)).toBe(true);
    expect(stack()?.classList.contains('cds--g100')).toBe(true);
  });

  it('uses role=alert for errors', () => {
    const { api } = renderToasts();
    act(() => {
      api().show({ kind: 'error', title: 'Failed' });
    });
    expect(screen.getByRole('alert').textContent).toContain('Failed');
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
    expect(stack()).toBeNull();
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
