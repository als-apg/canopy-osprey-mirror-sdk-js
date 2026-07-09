import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateToNs, msToNs, nowNs, nsToDate, nsToMs } from './time.js';

describe('time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('nowNs() is Date.now() scaled to nanoseconds', () => {
    vi.setSystemTime(new Date('2026-01-02T03:04:05.678Z'));
    expect(nowNs()).toBe(Date.now() * 1_000_000);
  });

  it('msToNs / nsToMs round-trip and truncate fractional parts', () => {
    expect(msToNs(1234)).toBe(1_234_000_000);
    expect(msToNs(1234.9)).toBe(1_234_000_000); // fractional ms truncated
    expect(nsToMs(1_234_000_000)).toBe(1234);
    expect(nsToMs(1_234_999_999)).toBe(1234); // sub-ms truncated
    expect(nsToMs(msToNs(1_700_000_000_123))).toBe(1_700_000_000_123);
  });

  it('dateToNs / nsToDate convert to and from Date at ms resolution', () => {
    const date = new Date('2026-01-02T03:04:05.678Z');
    const ns = dateToNs(date);
    expect(ns).toBe(date.getTime() * 1_000_000);
    expect(nsToDate(ns).getTime()).toBe(date.getTime());
  });
});
