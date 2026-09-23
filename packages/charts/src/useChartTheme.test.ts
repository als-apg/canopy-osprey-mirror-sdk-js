import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { setColorMode } from '@slaclab/canopy-shell';
import { useChartTheme } from './useChartTheme.js';
import { CHART_THEMES } from './theme.js';

beforeEach(() => {
  window.localStorage.clear();
  setColorMode('dark');
});

afterEach(() => {
  cleanup();
});

describe('useChartTheme', () => {
  it('follows the canopy-shell color mode', () => {
    const { result } = renderHook(() => useChartTheme());
    expect(result.current).toBe(CHART_THEMES.dark);
    act(() => {
      setColorMode('light');
    });
    expect(result.current).toBe(CHART_THEMES.light);
  });
});
