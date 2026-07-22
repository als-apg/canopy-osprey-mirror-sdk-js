import { describe, expect, it, vi } from 'vitest';
import { LocalPVService, parseLocUrl } from './LocalPVService.js';
import { RoutedPVService } from './RoutedPVService.js';
import { MockPVService } from './MockPVService.js';

describe('parseLocUrl', () => {
  it('parses the declaring form', () => {
    expect(parseLocUrl('loc://${!W}posVis?type=int&init=0')).toEqual({
      name: '${!W}posVis',
      type: 'int',
      init: '0',
    });
  });

  it('parses the short form', () => {
    expect(parseLocUrl('loc://tab')).toEqual({ name: 'tab' });
  });

  it('rejects non-loc addresses', () => {
    expect(parseLocUrl('DEV:X')).toBeNull();
  });
});

describe('LocalPVService', () => {
  it('initializes from the declaring URL and delivers synchronously', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=2', listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ value: 2, connected: true });
  });

  it('short-form reads are disconnected until a declaration or put arrives', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel', listener);
    expect(listener.mock.calls[0]![0].connected).toBe(false);

    // A later declaring reference initializes the same local (shared name).
    const other = vi.fn();
    service.subscribe('loc://sel?type=int&init=7', other);
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 7, connected: true });
  });

  it('put updates every subscriber under any URL form of the same name', () => {
    const service = new LocalPVService();
    service.connect();
    const a = vi.fn();
    const b = vi.fn();
    service.subscribe('loc://sel?type=int&init=0', a);
    service.subscribe('loc://sel', b);
    service.put('loc://sel', 3);
    expect(a.mock.lastCall![0].value).toBe(3);
    expect(b.mock.lastCall![0].value).toBe(3);
    expect(service.getSnapshot('loc://sel')?.value).toBe(3);
  });

  it('re-declaration does not reset an initialized local (first wins)', () => {
    const service = new LocalPVService();
    service.connect();
    service.put('loc://sel?type=int&init=0', 5);
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=0', listener);
    expect(listener.mock.calls[0]![0].value).toBe(5);
  });

  it('clear() resets scope: locals disconnect and re-initialize fresh', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=1', listener);
    service.put('loc://sel', 9);
    service.clear();
    expect(listener.mock.lastCall![0].connected).toBe(false);
    // Next declaring subscribe re-initializes.
    const fresh = vi.fn();
    service.subscribe('loc://sel?type=int&init=1', fresh);
    expect(fresh.mock.lastCall![0]).toMatchObject({ value: 1, connected: true });
  });

  it('keeps string locals as strings', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://label?type=str&init=OFF', listener);
    expect(listener.mock.calls[0]![0].value).toBe('OFF');
  });
});

describe('RoutedPVService', () => {
  it('routes loc:// to the local service and the rest to the fallback', () => {
    const local = new LocalPVService();
    const fallback = new MockPVService();
    const routed = new RoutedPVService({ 'loc://': local }, fallback);
    routed.connect();

    const locListener = vi.fn();
    routed.subscribe('loc://x?type=int&init=4', locListener);
    expect(locListener.mock.calls[0]![0].value).toBe(4);

    const caListener = vi.fn();
    routed.subscribe('DEV:PRESSURE', caListener);
    expect(caListener).toHaveBeenCalled();
    expect(local.getSnapshot('DEV:PRESSURE')).toBeUndefined();

    routed.put('loc://x', 6);
    expect(local.getSnapshot('loc://x')?.value).toBe(6);
  });
});
