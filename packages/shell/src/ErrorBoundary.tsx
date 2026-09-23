import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button, InlineNotification } from '@carbon/react';

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : String(value));
}

export interface ErrorFallbackProps {
  error: Error;
  /** Shown as "Try again" when provided. */
  reset?: () => void;
  /** Heading. Default 'Something went wrong'. */
  title?: string;
}

/**
 * The default error panel: a Carbon error notification with the message, plus
 * "Try again" (re-render the failed subtree) and "Reload" (reload the page).
 * Reusable outside ErrorBoundary, e.g. as a router's error component.
 */
export function ErrorFallback({
  error,
  reset,
  title = 'Something went wrong',
}: ErrorFallbackProps) {
  return (
    <div className="canopy-error-fallback">
      <InlineNotification
        kind="error"
        role="alert"
        lowContrast
        hideCloseButton
        title={title}
        subtitle={error.message || error.name || 'Unknown error'}
      />
      <div className="canopy-error-fallback__actions">
        {reset && (
          <Button kind="primary" size="sm" onClick={reset}>
            Try again
          </Button>
        )}
        <Button kind="secondary" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback; default is <ErrorFallback>. `reset` clears the error and re-renders children. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Called once per caught error (log it, report it). */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Values that reset the boundary when any of them changes (e.g. the route
   * pathname), so navigating away from a crashed page recovers.
   */
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
}

/** Catches render errors in its subtree and shows a fallback instead of a blank page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(toError(error), info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    // Only an error that was already showing is cleared; one caught in this very
    // update (possibly caused by the new keys) stays.
    if (
      prevState.error &&
      this.state.error &&
      keysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback ? (
      this.props.fallback(error, this.reset)
    ) : (
      <ErrorFallback error={error} reset={this.reset} />
    );
  }
}
