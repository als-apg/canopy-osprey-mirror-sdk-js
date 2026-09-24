import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AlarmSeverity, DISCONNECTED_PV, MockPVService } from '@slaclab/canopy-client';
import type { PVData, PVListener, PVService } from '@slaclab/canopy-client';
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

describe('usePV when the PV name changes', () => {
  /** A PVService that only delivers when the test pushes (no synchronous replay). */
  function makeManualService(snapshots: Record<string, PVData> = {}) {
    const listeners = new Map<string, Set<PVListener>>();
    const manual: PVService = {
      subscribe(pvName, listener) {
        const set = listeners.get(pvName) ?? new Set<PVListener>();
        set.add(listener);
        listeners.set(pvName, set);
        return () => set.delete(listener);
      },
      put: vi.fn(),
      getSnapshot: (pvName) => snapshots[pvName],
      connect() {},
      disconnect() {},
      isConnected: true,
    };
    const push = (pvName: string, value: number) => {
      const data: PVData = {
        ...DISCONNECTED_PV,
        value,
        displayValue: String(value),
        connected: true,
      };
      act(() => {
        for (const listener of listeners.get(pvName) ?? []) listener(data);
      });
    };
    return { manual, push, listeners };
  }

  function renderWith(manual: PVService, initialPv: string | undefined) {
    const manualWrapper = ({ children }: { children: ReactNode }) => (
      <PVServiceProvider service={manual}>{children}</PVServiceProvider>
    );
    return renderHook(({ pv }: { pv: string | undefined }) => usePV(pv), {
      wrapper: manualWrapper,
      initialProps: { pv: initialPv },
    });
  }

  it("never shows the previous PV's value while the new one has no data yet", () => {
    const { manual, push } = makeManualService();
    const { result, rerender } = renderWith(manual, 'A');

    push('A', 5);
    expect(result.current).toMatchObject({ address: 'A', value: 5, connected: true });

    rerender({ pv: 'B' });
    expect(result.current).toMatchObject({
      address: 'B',
      value: DISCONNECTED_PV.value,
      displayValue: '---',
      connected: false,
    });

    push('B', 7);
    expect(result.current).toMatchObject({ address: 'B', value: 7, connected: true });
  });

  it("shows the service's cached snapshot for the new PV immediately", () => {
    const cached: PVData = { ...DISCONNECTED_PV, value: 42, displayValue: '42', connected: true };
    const { manual, push } = makeManualService({ B: cached });
    const { result, rerender } = renderWith(manual, 'A');
    push('A', 5);

    rerender({ pv: 'B' });
    expect(result.current).toMatchObject({ address: 'B', value: 42, connected: true });
  });

  it("going A -> B -> A does not bring back A's value from before the switch", () => {
    const { manual, push } = makeManualService();
    const { result, rerender } = renderWith(manual, 'A');
    push('A', 5);
    expect(result.current).toMatchObject({ address: 'A', value: 5, connected: true });

    rerender({ pv: 'B' });
    rerender({ pv: 'A' }); // before B (or the new A subscription) delivers anything
    expect(result.current).toMatchObject({
      address: 'A',
      value: DISCONNECTED_PV.value,
      displayValue: '---',
      connected: false,
    });

    push('A', 6);
    expect(result.current).toMatchObject({ address: 'A', value: 6, connected: true });
  });

  it("going A -> B -> A shows the service's current snapshot for A, not the old delivery", () => {
    const snapshots: Record<string, PVData> = {};
    const { manual, push } = makeManualService(snapshots);
    const { result, rerender } = renderWith(manual, 'A');
    push('A', 5);

    rerender({ pv: 'B' });
    // Meanwhile the service learned that A disconnected.
    snapshots.A = { ...DISCONNECTED_PV, value: 5, displayValue: '5', connected: false };
    rerender({ pv: 'A' });
    expect(result.current).toMatchObject({ address: 'A', connected: false });
  });

  it('drops an update from a torn-down subscription to the same PV', () => {
    const { manual, listeners } = makeManualService();
    const { result, rerender } = renderWith(manual, 'A');
    const staleListener = [...listeners.get('A')!][0]!;

    rerender({ pv: 'B' });
    rerender({ pv: 'A' });
    act(() => {
      staleListener({ ...DISCONNECTED_PV, value: 99, connected: true });
    });
    expect(result.current).toMatchObject({ address: 'A', connected: false });
  });

  it('ignores a late update from the previous subscription and resets for undefined', () => {
    const { manual, push, listeners } = makeManualService();
    const { result, rerender } = renderWith(manual, 'A');
    const staleListener = [...listeners.get('A')!][0]!;

    rerender({ pv: 'B' });
    act(() => {
      staleListener({ ...DISCONNECTED_PV, value: 99, connected: true });
    });
    expect(result.current).toMatchObject({ address: 'B', connected: false });

    push('B', 1);
    rerender({ pv: undefined });
    expect(result.current).toMatchObject({ address: '', connected: false, displayValue: '---' });
  });
});
