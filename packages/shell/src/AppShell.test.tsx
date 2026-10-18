import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppShell } from './AppShell.js';
import { AppHeader } from './AppHeader.js';
import { SideNavRail } from './SideNavRail.js';

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('renders header, main with the default id, and the content', () => {
    render(
      <AppShell header={<AppHeader productName="Badger" fixed />}>
        <p>page</p>
      </AppShell>
    );
    const main = screen.getByRole('main');
    expect(main.id).toBe('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByText('page').closest('.canopy-shell__content')).not.toBeNull();
    // The header's default skip link targets the shell's main.
    expect(screen.getByText('Skip to main content').getAttribute('href')).toBe(`#${main.id}`);
  });

  it('uses a custom main id', () => {
    render(
      <AppShell header={null} mainId="content">
        x
      </AppShell>
    );
    expect(screen.getByRole('main').id).toBe('content');
  });

  it('has no rail modifier without a side nav', () => {
    const { container } = render(<AppShell header={null}>x</AppShell>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('canopy-shell');
  });

  it('offsets main for an expanded or collapsed rail', () => {
    const rail = (expanded: boolean) => (
      <SideNavRail
        items={[{ id: 'a', label: 'A', href: '/a' }]}
        expanded={expanded}
        activeHref="/a"
      />
    );
    const { container, rerender } = render(
      <AppShell header={null} sideNav={rail(true)} sideNavExpanded className="app">
        x
      </AppShell>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('canopy-shell--rail-expanded')).toBe(true);
    expect(root.classList.contains('app')).toBe(true);
    expect(screen.getByRole('navigation')).toBeDefined();

    rerender(
      <AppShell header={null} sideNav={rail(false)} sideNavExpanded={false}>
        x
      </AppShell>
    );
    expect(root.classList.contains('canopy-shell--rail-collapsed')).toBe(true);
    expect(root.classList.contains('canopy-shell--rail-expanded')).toBe(false);
  });

  it('defaults to an expanded rail', () => {
    const { container } = render(
      <AppShell header={null} sideNav={<nav aria-label="n" />}>
        x
      </AppShell>
    );
    expect(
      (container.firstElementChild as HTMLElement).classList.contains('canopy-shell--rail-expanded')
    ).toBe(true);
  });

  it('renders banners above the scrolling content, inside main', () => {
    render(
      <AppShell header={null} banners={<div role="alert">Canopy unreachable</div>}>
        <p>page</p>
      </AppShell>
    );
    const main = screen.getByRole('main');
    const banners = main.querySelector('.canopy-shell__banners') as HTMLElement;
    const content = main.querySelector('.canopy-shell__content') as HTMLElement;
    expect(banners.textContent).toBe('Canopy unreachable');
    expect(
      banners.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('omits the banner container when there are no banners', () => {
    render(
      <AppShell header={null} banners={false}>
        x
      </AppShell>
    );
    expect(screen.getByRole('main').querySelector('.canopy-shell__banners')).toBeNull();
  });
});
