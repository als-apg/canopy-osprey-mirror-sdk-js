// jsdom does not implement matchMedia; @carbon/react's Theme/Header
// components query it internally, so stub a minimal version before import.
if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppHeader } from './AppHeader.js';

// vitest.config.ts does not set `test.globals: true`, so @testing-library/react's
// own auto-cleanup (which detects a *global* afterEach) never registers. Do it
// explicitly instead, otherwise each render() in this file piles onto the same
// document and later queries see every previously mounted header.
afterEach(() => {
  cleanup();
});

describe('AppHeader', () => {
  it('renders the title text', () => {
    render(<AppHeader title="MYAPP" />);
    expect(screen.getByText('MYAPP')).toBeDefined();
  });

  it('renders the toolbar node', () => {
    render(<AppHeader title="MYAPP" toolbar={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('renders as a banner landmark with aria-label equal to the title', () => {
    render(<AppHeader title="MYAPP" />);
    expect(screen.getByRole('banner').getAttribute('aria-label')).toBe('MYAPP');
  });

  it('renders the children middle slot', () => {
    render(<AppHeader title="MYAPP">{<span>3 Live</span>}</AppHeader>);
    expect(screen.getByText('3 Live')).toBeDefined();
  });
});
