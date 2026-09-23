import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARBON_THEME,
  configureColorMode,
  getColorMode,
  resetColorModeForTests,
  setColorMode,
  toggleColorMode,
  useColorMode,
} from './themeStore.js';

beforeEach(() => {
  window.localStorage.clear();
  resetColorModeForTests();
  document.documentElement.className = '';
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('themeStore (0.1 API)', () => {
  it('defaults to dark', () => {
    expect(getColorMode()).toBe('dark');
  });

  it('toggleColorMode flips to light and persists it', () => {
    toggleColorMode();
    expect(getColorMode()).toBe('light');
    expect(window.localStorage.getItem('canopy.theme')).toBe('light');
  });

  it('setColorMode with the same value is a no-op', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setColorMode('dark');
    expect(getColorMode()).toBe('dark');
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('useColorMode returns colorMode/toggle and mirrors the mode onto the document', () => {
    const { result } = renderHook(() => useColorMode());
    expect(result.current.colorMode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      result.current.toggle();
    });

    expect(result.current.colorMode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads a stored choice lazily on first access', () => {
    window.localStorage.setItem('canopy.theme', 'light');
    resetColorModeForTests();
    expect(getColorMode()).toBe('light');
  });

  it('ignores an invalid stored value', () => {
    window.localStorage.setItem('canopy.theme', 'purple');
    expect(getColorMode()).toBe('dark');
  });
});

describe('themeStore storage guards', () => {
  it('does not crash when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getColorMode()).toBe('dark');
  });

  it('does not crash when localStorage.setItem throws, and still switches mode', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => toggleColorMode()).not.toThrow();
    expect(getColorMode()).toBe('light');
  });
});

describe('configureColorMode', () => {
  it('uses the configured storage key and default mode', () => {
    configureColorMode({ storageKey: 'badger.theme', defaultMode: 'light' });
    expect(getColorMode()).toBe('light');
    toggleColorMode();
    expect(window.localStorage.getItem('badger.theme')).toBe('dark');
    expect(window.localStorage.getItem('canopy.theme')).toBeNull();
  });

  it('reads an existing choice under the configured key', () => {
    window.localStorage.setItem('badger.theme', 'light');
    configureColorMode({ storageKey: 'badger.theme' });
    expect(getColorMode()).toBe('light');
  });

  it('migrates the first valid legacy key into the new key', () => {
    window.localStorage.setItem('trace.theme', 'bogus');
    window.localStorage.setItem('squirrel-color-mode', 'light');
    configureColorMode({
      storageKey: 'app.theme',
      defaultMode: 'dark',
      legacyKeys: ['trace.theme', 'squirrel-color-mode'],
    });
    expect(getColorMode()).toBe('light');
    expect(window.localStorage.getItem('app.theme')).toBe('light');
  });

  it('prefers the new key over legacy keys', () => {
    window.localStorage.setItem('app.theme', 'dark');
    window.localStorage.setItem('trace.theme', 'light');
    configureColorMode({ storageKey: 'app.theme', legacyKeys: ['trace.theme'] });
    expect(getColorMode()).toBe('dark');
  });

  it('notifies mounted hooks when reconfigured after first read', () => {
    const { result } = renderHook(() => useColorMode());
    expect(result.current.colorMode).toBe('dark');
    act(() => {
      configureColorMode({ storageKey: 'other.theme', defaultMode: 'light' });
    });
    expect(result.current.colorMode).toBe('light');
  });
});

describe('document sync', () => {
  it('maps modes to Carbon g10/g100', () => {
    expect(CARBON_THEME).toEqual({ light: 'g10', dark: 'g100' });
  });

  it('swaps cds--g10/cds--g100 on <html> and keeps other classes', () => {
    document.documentElement.classList.add('app-root', 'cds--g90');
    const { result } = renderHook(() => useColorMode());
    const cl = document.documentElement.classList;
    expect(cl.contains('cds--g100')).toBe(true);
    expect(cl.contains('cds--g10')).toBe(false);
    expect(cl.contains('cds--g90')).toBe(false);
    expect(cl.contains('app-root')).toBe(true);
    expect(result.current.carbonTheme).toBe('g100');

    act(() => {
      result.current.setColorMode('light');
    });
    expect(cl.contains('cds--g10')).toBe(true);
    expect(cl.contains('cds--g100')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(result.current.carbonTheme).toBe('g10');
  });
});
