import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getColorMode, setColorMode, toggleColorMode, useColorMode } from './themeStore.js';

beforeEach(() => {
  setColorMode('dark');
  window.localStorage.clear();
});

describe('themeStore', () => {
  it('defaults to dark', () => {
    expect(getColorMode()).toBe('dark');
  });

  it('toggleColorMode flips to light and persists it', () => {
    toggleColorMode();
    expect(getColorMode()).toBe('light');
    expect(window.localStorage.getItem('canopy.theme')).toBe('light');
  });

  it('setColorMode with the same value is a no-op', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    setColorMode('dark');
    expect(getColorMode()).toBe('dark');
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
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
});
