import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary, ErrorFallback } from './ErrorBoundary.js';

let shouldThrow = true;

function Bomb({ label = 'child ok' }: { label?: string }) {
  if (shouldThrow) throw new Error('kaboom');
  return <p>{label}</p>;
}

beforeEach(() => {
  shouldThrow = true;
  // React logs caught render errors; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('child ok')).toBeDefined();
  });

  it('shows the default fallback with the message and both actions', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).toContain('kaboom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });

  it('"Try again" resets and re-renders the children', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('child ok')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Reload" reloads the page', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('uses a custom fallback and its reset', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <div>
            <span>custom: {error.message}</span>
            <button onClick={reset}>again</button>
          </div>
        )}
      >
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('custom: kaboom')).toBeDefined();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'again' }));
    expect(screen.getByText('child ok')).toBeDefined();
  });

  it('calls onError once with the error', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('kaboom');
  });

  it('wraps non-Error throws', () => {
    function Thrower(): never {
      throw 'plain string';
    }
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert').textContent).toContain('plain string');
  });

  it('resets when resetKeys change', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['/runs/1']}>
        <Bomb label="page 1" />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeDefined();
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKeys={['/runs/1']}>
        <Bomb label="page 1" />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeDefined();
    rerender(
      <ErrorBoundary resetKeys={['/runs/2']}>
        <Bomb label="page 2" />
      </ErrorBoundary>
    );
    expect(screen.getByText('page 2')).toBeDefined();
  });
});

describe('ErrorFallback', () => {
  it('omits "Try again" without reset and accepts a title', () => {
    render(<ErrorFallback error={new Error('nope')} title="Route failed" />);
    expect(screen.getByText('Route failed')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });
});
