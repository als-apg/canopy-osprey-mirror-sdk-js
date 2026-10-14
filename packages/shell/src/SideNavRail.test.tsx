import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Dashboard, Settings } from '@carbon/icons-react';
import { SideNavRail, findActiveNavItem } from './SideNavRail.js';
import type { NavItem } from './SideNavRail.js';

afterEach(() => {
  cleanup();
});

/**
 * Click `el` and report whether the rail prevented the default navigation.
 * A window-level listener (last in bubble order) records the component's
 * decision, then cancels the event itself so jsdom never tries to navigate.
 */
function clickPrevented(el: Element, init: MouseEventInit = {}): boolean {
  let prevented = false;
  const listener = (e: Event) => {
    prevented = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener('click', listener);
  try {
    fireEvent.click(el, { button: 0, ...init });
  } finally {
    window.removeEventListener('click', listener);
  }
  return prevented;
}

const items: NavItem[] = [
  { id: 'dash', label: 'Dashboard', href: '/', icon: Dashboard },
  { id: 'runs', label: 'Runs', href: '/runs' },
  { id: 'runs-new', label: 'New run', href: '/runs/new' },
  { id: 'routines', label: 'Routines', href: '/routines' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, section: 'footer' },
];

describe('findActiveNavItem', () => {
  it('matches exactly or by path-segment prefix', () => {
    expect(findActiveNavItem(items, '/runs')).toBe('runs');
    expect(findActiveNavItem(items, '/runs/42')).toBe('runs');
    expect(findActiveNavItem(items, '/routines/abc/edit')).toBe('routines');
  });

  it('does not match a partial segment', () => {
    expect(findActiveNavItem(items, '/runsx')).toBeUndefined();
    expect(findActiveNavItem(items, '/routine')).toBeUndefined();
  });

  it("only matches '/' exactly", () => {
    expect(findActiveNavItem(items, '/')).toBe('dash');
    expect(findActiveNavItem(items, '/settings')).toBe('settings');
  });

  it('prefers the longest matching href', () => {
    expect(findActiveNavItem(items, '/runs/new')).toBe('runs-new');
    expect(findActiveNavItem(items, '/runs/new/step2')).toBe('runs-new');
  });

  it('ignores query and hash', () => {
    expect(findActiveNavItem(items, '/runs/7?tab=events#top')).toBe('runs');
  });

  it('supports hash-router hrefs', () => {
    const hashed = items.map((i) => ({ ...i, href: `#${i.href}` }));
    expect(findActiveNavItem(hashed, '#/runs/42')).toBe('runs');
    expect(findActiveNavItem(hashed, '#/')).toBe('dash');
    expect(findActiveNavItem(hashed, '#/runs/new?x=1')).toBe('runs-new');
  });

  it("matches an href ending in '/' only on its own path, with or without the slash", () => {
    const home = [
      { id: 'home', label: 'Home', href: '/badger/' },
      { id: 'runs', label: 'Runs', href: '/badger/runs' },
    ];
    expect(findActiveNavItem(home, '/badger/')).toBe('home');
    expect(findActiveNavItem(home, '/badger')).toBe('home');
    expect(findActiveNavItem(home, '/badger/runs/3')).toBe('runs');
    expect(findActiveNavItem(home, '/badger/unknown')).toBeUndefined();
    // A trailing slash on the location is ignored for other items too.
    expect(findActiveNavItem(home, '/badger/runs/')).toBe('runs');
  });

  it('works with a base path', () => {
    const based = items.map((i) => ({ ...i, href: `/badger${i.href === '/' ? '' : i.href}` }));
    expect(findActiveNavItem(based, '/badger')).toBe('dash');
    expect(findActiveNavItem(based, '/badger/runs/3')).toBe('runs');
  });
});

describe('SideNavRail', () => {
  it('renders a labelled nav landmark with plain links', () => {
    render(<SideNavRail items={items} expanded activeHref="/runs/1" />);
    const nav = screen.getByRole('navigation', { name: 'Side navigation' });
    const link = within(nav).getByRole('link', { name: 'Runs' });
    expect(link.getAttribute('href')).toBe('/runs');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe(
      null
    );
  });

  it('uses a custom aria-label and className', () => {
    render(
      <SideNavRail items={items} expanded activeHref="/" ariaLabel="Badger" className="extra" />
    );
    const nav = screen.getByRole('navigation', { name: 'Badger' });
    expect(nav.classList.contains('extra')).toBe(true);
  });

  it('puts footer-section items and the footer slot at the bottom', () => {
    const { container } = render(
      <SideNavRail
        items={items}
        expanded
        activeHref="/settings"
        footer={<button>Save snapshot</button>}
      />
    );
    const footer = container.querySelector('.canopy-rail__footer') as HTMLElement;
    expect(within(footer).getByRole('link', { name: 'Settings' })).toBeDefined();
    expect(within(footer).getByRole('button', { name: 'Save snapshot' })).toBeDefined();
    const mainList = container.querySelector('.canopy-rail > .canopy-rail__list') as HTMLElement;
    expect(within(mainList).queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('renders no footer area when there is nothing to put in it', () => {
    const { container } = render(<SideNavRail items={items.slice(0, 2)} expanded activeHref="/" />);
    expect(container.querySelector('.canopy-rail__footer')).toBeNull();
  });

  describe('click handling', () => {
    it('intercepts a plain left-click and calls onNavigate', () => {
      const onNavigate = vi.fn();
      render(<SideNavRail items={items} expanded activeHref="/" onNavigate={onNavigate} />);
      const link = screen.getByRole('link', { name: 'Routines' });
      expect(clickPrevented(link)).toBe(true);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate.mock.calls[0][0]).toBe('/routines');
    });

    it.each([
      ['ctrl', { ctrlKey: true }],
      ['meta', { metaKey: true }],
      ['shift', { shiftKey: true }],
      ['alt', { altKey: true }],
      ['middle button', { button: 1 }],
    ])('leaves a %s click to the browser', (_name, init) => {
      const onNavigate = vi.fn();
      render(<SideNavRail items={items} expanded activeHref="/" onNavigate={onNavigate} />);
      expect(clickPrevented(screen.getByRole('link', { name: 'Routines' }), init)).toBe(false);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('does not prevent default without onNavigate', () => {
      render(<SideNavRail items={items} expanded activeHref="/" />);
      expect(clickPrevented(screen.getByRole('link', { name: 'Routines' }))).toBe(false);
    });
  });

  describe('expanded vs collapsed', () => {
    it('shows labels and the expanded modifier when expanded', () => {
      const { container } = render(<SideNavRail items={items} expanded activeHref="/" />);
      const nav = screen.getByRole('navigation');
      expect(nav.classList.contains('canopy-rail--expanded')).toBe(true);
      expect(container.querySelectorAll('.canopy-rail__label')).toHaveLength(items.length);
      expect(screen.queryAllByRole('tooltip', { hidden: true })).toHaveLength(0);
    });

    it('hides visible labels but keeps accessible names via tooltips when collapsed', () => {
      const onNavigate = vi.fn();
      const { container } = render(
        <SideNavRail items={items} expanded={false} activeHref="/runs" onNavigate={onNavigate} />
      );
      const nav = screen.getByRole('navigation');
      expect(nav.classList.contains('canopy-rail--collapsed')).toBe(true);
      expect(container.querySelectorAll('.canopy-rail__label')).toHaveLength(0);

      const tooltips = screen.getAllByRole('tooltip', { hidden: true });
      expect(tooltips.map((t) => t.textContent)).toEqual(items.map((i) => i.label));

      const runs = screen.getByRole('link', { name: 'Runs' });
      expect(runs.getAttribute('aria-current')).toBe('page');
      expect(clickPrevented(runs)).toBe(true);
      expect(onNavigate).toHaveBeenCalledWith('/runs', expect.anything());
    });

    it('falls back to the label initial when an item has no icon', () => {
      const { container } = render(<SideNavRail items={items} expanded={false} activeHref="/" />);
      const initials = [...container.querySelectorAll('.canopy-rail__icon--initial')].map(
        (e) => e.textContent
      );
      expect(initials).toEqual(['R', 'N', 'R']);
    });
  });
});
