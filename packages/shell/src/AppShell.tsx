import type { ReactNode } from 'react';

export interface AppShellProps {
  /** Usually `<AppHeader fixed ... />`; AppShell pins it to the top either way. */
  header: ReactNode;
  /** Usually `<SideNavRail ... />`. Omit for a header-only layout. */
  sideNav?: ReactNode;
  /** Whether the rail is expanded (256px) or collapsed (48px). Default true. */
  sideNavExpanded?: boolean;
  /** Full-width notifications stacked above the scrolling content (e.g. "API unreachable"). */
  banners?: ReactNode;
  /** id of the <main> element — the skip link target. Default 'main-content'. */
  mainId?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Page layout for multi-page apps (react-squirrel's Layout): a fixed header, an
 * optional fixed side rail, and a <main> offset by the header height and the
 * rail width (with the rail's width transition). Banners sit at the top of
 * <main>; the content below them scrolls inside <main>, not the page.
 */
export function AppShell({
  header,
  sideNav,
  sideNavExpanded = true,
  banners,
  mainId = 'main-content',
  className,
  children,
}: AppShellProps) {
  const hasRail = sideNav != null && sideNav !== false;
  const classes = [
    'canopy-shell',
    hasRail && (sideNavExpanded ? 'canopy-shell--rail-expanded' : 'canopy-shell--rail-collapsed'),
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const hasBanners = banners != null && banners !== false;

  return (
    <div className={classes}>
      {header}
      {sideNav}
      <main id={mainId} className="canopy-shell__main" tabIndex={-1}>
        {hasBanners && <div className="canopy-shell__banners">{banners}</div>}
        <div className="canopy-shell__content">{children}</div>
      </main>
    </div>
  );
}
