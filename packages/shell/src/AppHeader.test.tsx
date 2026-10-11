import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HeaderGlobalAction } from '@carbon/react';
import { AppHeader, ThemeToggleAction } from './AppHeader.js';
import { getColorMode, resetColorModeForTests, setColorMode } from './themeStore.js';

// vitest.config.ts does not set `test.globals: true`, so @testing-library/react's
// own auto-cleanup (which detects a *global* afterEach) never registers. Do it
// explicitly instead, otherwise each render() in this file piles onto the same
// document and later queries see every previously mounted header.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  resetColorModeForTests();
});

function globalBarLabels(): string[] {
  const banner = screen.getByRole('banner');
  return within(banner)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')
    .filter((label) => !/menu/i.test(label));
}

describe('AppHeader (0.1 compatibility)', () => {
  it('renders the deprecated title prop as the product name', () => {
    render(<AppHeader title="MYAPP" />);
    expect(screen.getByText('MYAPP')).toBeDefined();
  });

  it('renders the deprecated toolbar node', () => {
    render(<AppHeader title="MYAPP" toolbar={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('renders as a banner landmark with aria-label equal to the name', () => {
    render(<AppHeader title="MYAPP" />);
    expect(screen.getByRole('banner').getAttribute('aria-label')).toBe('MYAPP');
  });

  it('renders the children middle slot', () => {
    render(<AppHeader title="MYAPP">{<span>3 Live</span>}</AppHeader>);
    expect(screen.getByText('3 Live')).toBeDefined();
  });

  it('prefers productName over title and actions over toolbar', () => {
    render(
      <AppHeader
        productName="Badger"
        title="Old"
        actions={<button>New action</button>}
        toolbar={<button>Old action</button>}
      />
    );
    expect(screen.getByText('Badger')).toBeDefined();
    expect(screen.queryByText('Old')).toBeNull();
    expect(screen.getByRole('button', { name: 'New action' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Old action' })).toBeNull();
  });
});

describe('AppHeader branding', () => {
  it('renders the SLAC prefix with the Carbon prefix class by default', () => {
    const { container } = render(<AppHeader productName="Badger" />);
    const prefix = container.querySelector('.cds--header__name--prefix');
    expect(prefix?.textContent).toBe('SLAC');
    expect(container.querySelector('.canopy-header__name')?.textContent).toContain('Badger');
  });

  it('hides the prefix when prefix=""', () => {
    const { container } = render(<AppHeader productName="Badger" prefix="" />);
    expect(container.querySelector('.cds--header__name--prefix')).toBeNull();
  });

  it('colors the name in brand red by default; brandColor={false} turns it off', () => {
    const { rerender } = render(<AppHeader productName="Badger" />);
    expect(screen.getByRole('banner').classList.contains('canopy-header--brand')).toBe(true);
    rerender(<AppHeader productName="Badger" brandColor={false} />);
    expect(screen.getByRole('banner').classList.contains('canopy-header--brand')).toBe(false);
  });

  it('appends the context after a middle dot', () => {
    render(<AppHeader productName="Squirrel" context="LCLS" />);
    expect(screen.getByText('Squirrel · LCLS')).toBeDefined();
  });

  it("theme='inherit' (default) renders no Carbon theme wrapper", () => {
    const { container } = render(<AppHeader productName="Badger" />);
    expect(container.querySelector('.cds--g100')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('HEADER');
  });

  it("theme='g100' wraps the header in a g100 theme (0.1 look)", () => {
    const { container } = render(
      <AppHeader productName="Badger" theme="g100" prefix="" brandColor={false} />
    );
    const wrapper = container.querySelector('.cds--g100');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('header')).not.toBeNull();
    expect(wrapper?.querySelector('.canopy-header--brand')).toBeNull();
  });

  it('is in-flow by default and gets the fixed modifier when fixed', () => {
    const { rerender } = render(<AppHeader productName="Badger" />);
    const header = screen.getByRole('banner');
    expect(header.classList.contains('canopy-header')).toBe(true);
    expect(header.classList.contains('canopy-header--fixed')).toBe(false);
    rerender(<AppHeader productName="Badger" fixed className="extra" />);
    expect(screen.getByRole('banner').classList.contains('canopy-header--fixed')).toBe(true);
    expect(screen.getByRole('banner').classList.contains('extra')).toBe(true);
  });
});

describe('AppHeader name link', () => {
  it("links to '#' by default and to href when given", () => {
    const { rerender } = render(<AppHeader productName="Badger" />);
    expect(screen.getByRole('link', { name: /Badger/ }).getAttribute('href')).toBe('#');
    rerender(<AppHeader productName="Badger" href="/badger/" />);
    expect(screen.getByRole('link', { name: /Badger/ }).getAttribute('href')).toBe('/badger/');
  });

  it('renders nameAs in place of the anchor and passes href to it', () => {
    function RouterLink({ href, children, ...rest }: { href?: string; children?: ReactNode }) {
      return (
        <a data-router-link="true" data-to={href} href={href} {...rest}>
          {children}
        </a>
      );
    }
    render(<AppHeader productName="Badger" href="/" nameAs={RouterLink} />);
    const link = screen.getByRole('link', { name: /Badger/ });
    expect(link.getAttribute('data-router-link')).toBe('true');
    expect(link.getAttribute('data-to')).toBe('/');
    expect(link.classList.contains('cds--header__name')).toBe(true);
  });
});

describe('AppHeader skip link', () => {
  it("renders a skip link to '#main-content' by default", () => {
    render(<AppHeader productName="Badger" />);
    const skip = screen.getByText('Skip to main content');
    expect(skip.getAttribute('href')).toBe('#main-content');
  });

  it('uses a custom skip target', () => {
    render(<AppHeader productName="Badger" skipToContent="#content" />);
    expect(screen.getByText('Skip to main content').getAttribute('href')).toBe('#content');
  });

  it('omits the skip link with skipToContent={false}', () => {
    render(<AppHeader productName="Badger" skipToContent={false} />);
    expect(screen.queryByText('Skip to main content')).toBeNull();
  });
});

describe('AppHeader menu button', () => {
  it('toggles its label with the open state and calls onToggle', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <AppHeader productName="Badger" menu={{ open: false, onToggle }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('banner').classList.contains('canopy-header--with-menu')).toBe(true);

    rerender(<AppHeader productName="Badger" menu={{ open: true, onToggle }} />);
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeDefined();
  });

  it('supports custom menu labels', () => {
    render(
      <AppHeader
        productName="Badger"
        menu={{ open: false, onToggle: () => {}, openLabel: 'Show nav', closeLabel: 'Hide nav' }}
      />
    );
    expect(screen.getByRole('button', { name: 'Show nav' })).toBeDefined();
  });

  it('renders no menu button without the menu prop', () => {
    render(<AppHeader productName="Badger" />);
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
  });
});

describe('AppHeader standard actions', () => {
  it('orders app actions → theme toggle → report bug → help', () => {
    render(
      <AppHeader
        productName="Badger"
        actions={
          <HeaderGlobalAction aria-label="Connection" onClick={() => {}}>
            <span />
          </HeaderGlobalAction>
        }
        themeToggle
        bugReportUrl="https://example.org/bug"
        helpUrl="https://example.org/docs"
      />
    );
    expect(globalBarLabels()).toEqual([
      'Connection',
      'Switch to light mode',
      'Report a bug',
      'Help',
    ]);
  });

  it('renders no standard actions by default', () => {
    render(<AppHeader productName="Badger" />);
    expect(globalBarLabels()).toEqual([]);
  });

  it('opens bug/help URLs in a new tab with noopener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <AppHeader
        productName="Badger"
        bugReportUrl="https://example.org/bug"
        helpUrl="https://example.org/docs"
        helpLabel="Docs"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(open).toHaveBeenNthCalledWith(
      1,
      'https://example.org/bug',
      '_blank',
      'noopener,noreferrer'
    );
    expect(open).toHaveBeenNthCalledWith(
      2,
      'https://example.org/docs',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('prefers onReportBug/onHelp handlers over URLs', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onReportBug = vi.fn();
    const onHelp = vi.fn();
    render(
      <AppHeader
        productName="Badger"
        bugReportUrl="https://example.org/bug"
        onReportBug={onReportBug}
        helpUrl="https://example.org/docs"
        onHelp={onHelp}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(onReportBug).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('theme toggle flips the store and swaps its label (Sun in dark, Moon in light)', () => {
    setColorMode('dark');
    render(<AppHeader productName="Badger" themeToggle />);
    const toDark = () => screen.queryByRole('button', { name: 'Switch to dark mode' });
    const toLight = () => screen.queryByRole('button', { name: 'Switch to light mode' });
    expect(toLight()).not.toBeNull();
    act(() => {
      fireEvent.click(toLight()!);
    });
    expect(getColorMode()).toBe('light');
    expect(toDark()).not.toBeNull();
  });

  it('appends the shortcut to the theme toggle label', () => {
    setColorMode('light');
    render(<AppHeader productName="Trace" themeToggle={{ shortcut: 'Alt+T' }} />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode (Alt+T)' })).toBeDefined();
  });

  it('ThemeToggleAction works standalone', () => {
    setColorMode('dark');
    render(<ThemeToggleAction />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeDefined();
  });
});
