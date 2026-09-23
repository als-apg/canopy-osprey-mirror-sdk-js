import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ColorModeTheme } from './ColorModeTheme.js';
import { resetColorModeForTests, setColorMode } from './themeStore.js';

beforeEach(() => {
  window.localStorage.clear();
  resetColorModeForTests();
});

afterEach(() => {
  cleanup();
});

describe('ColorModeTheme', () => {
  it('wraps children in the Carbon theme for the current mode', () => {
    render(
      <ColorModeTheme data-testid="root" className="app">
        <span>content</span>
      </ColorModeTheme>
    );
    const root = screen.getByTestId('root');
    expect(root.classList.contains('cds--g100')).toBe(true);
    expect(root.classList.contains('app')).toBe(true);
    expect(screen.getByText('content')).toBeDefined();

    act(() => {
      setColorMode('light');
    });
    expect(root.classList.contains('cds--g10')).toBe(true);
    expect(root.classList.contains('cds--g100')).toBe(false);
    expect(document.documentElement.classList.contains('cds--g10')).toBe(true);
  });
});
