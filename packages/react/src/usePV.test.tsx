import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AlarmSeverity, MockPVService } from '@slaclab/canopy-client';
import { PVServiceProvider } from './PVServiceProvider.js';
import { usePVService } from './pvServiceContext.js';
import { usePV } from './usePV.js';

let service: MockPVService;

function wrapper({ children }: { children: ReactNode }) {
  return <PVServiceProvider service={service}>{children}</PVServiceProvider>;
}

beforeEach(() => {
  // Fake timers keep MockPVService's simulation intervals from firing
  // mid-test; its initial value is delivered synchronously on subscribe.
  vi.useFakeTimers();
  service = new MockPVService();
  service.connect();
});

afterEach(() => {
  cleanup();
  service.disconnect();
  vi.useRealTimers();
});

describe('usePV', () => {
  it('returns live data from the provided service', () => {
    const { result } = renderHook(() => usePV('TEMP:BLDG:1'), { wrapper });

    expect(result.current.connected).toBe(true);
    expect(typeof result.current.value).toBe('number');
    expect(result.current.units).toBe('C');
    expect(result.current.address).toBe('TEMP:BLDG:1');
  });

  it('re-renders when the service pushes an update', () => {
    const { result } = renderHook(() => usePV('TEMP:BLDG:1'), { wrapper });

    act(() => {
      service.put('TEMP:BLDG:1', 99);
    });

    expect(result.current.value).toBe(99);
    expect(result.current.displayValue).toBe('99.0 C');
  });

  it('put() writes through the service and the new value comes back', () => {
    const { result } = renderHook(() => usePV('TEMP:BLDG:1'), { wrapper });

    act(() => {
      result.current.put(42);
    });

    expect(service.getSnapshot('TEMP:BLDG:1')?.value).toBe(42);
    expect(result.current.value).toBe(42);
  });

  it('returns the disconnected placeholder when pvName is undefined', () => {
    const { result } = renderHook(() => usePV(undefined), { wrapper });

    expect(result.current.connected).toBe(false);
    expect(result.current.severity).toBe(AlarmSeverity.DISCONNECTED);
    expect(result.current.displayValue).toBe('---');
    expect(result.current.address).toBe('');
    // put() on an addressless handle is a no-op, not a crash.
    expect(() => result.current.put(1)).not.toThrow();
  });

  it('unsubscribes from the service on unmount', () => {
    const unsubscribe = vi.fn();
    const subscribeSpy = vi.spyOn(service, 'subscribe').mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => usePV('X:1'), { wrapper });
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('usePVService', () => {
  it('throws when used outside a PVServiceProvider', () => {
    // React logs render-phase errors to console.error; keep the output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePVService())).toThrow(/PVServiceProvider/);
    consoleError.mockRestore();
  });
});
