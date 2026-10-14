import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockPVService } from './MockPVService.js';

describe('MockPVService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers an immediate value on subscribe and periodic updates thereafter', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    service.subscribe('DEMO:LASER:POWER', listener);

    // Initial value delivered synchronously.
    expect(listener).toHaveBeenCalledTimes(1);
    const first = listener.mock.calls[0]![0];
    expect(typeof first.value).toBe('number');
    expect(first.connected).toBe(true);

    // Periodic updates: advance well past the max simulated update rate
    // (5000ms + jitter) so at least one more tick is guaranteed.
    vi.advanceTimersByTime(6000);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
  });

  it('put() updates the value, formats displayValue, and notifies listeners', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    service.subscribe('TEMP:BLDG:1', listener);
    listener.mockClear();

    service.put('TEMP:BLDG:1', 42);

    expect(listener).toHaveBeenCalledTimes(1);
    const data = listener.mock.calls[0]![0];
    expect(data.value).toBe(42);
    expect(data.displayValue).toBe('42.0 C');

    const snapshot = service.getSnapshot('TEMP:BLDG:1');
    expect(snapshot?.value).toBe(42);
  });

  it('stops the interval once the last listener for a PV unsubscribes', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    const unsubscribe = service.subscribe('CURRENT:1', listener);

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);

    // No more notifications after unsubscribe, however long we wait.
    listener.mockClear();
    vi.advanceTimersByTime(10000);
    expect(listener).not.toHaveBeenCalled();
  });
});
