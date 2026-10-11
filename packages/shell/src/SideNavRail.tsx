import type { MouseEvent, ReactNode } from 'react';
import type { CarbonIconType } from '@carbon/icons-react';
import { Tooltip } from '@carbon/react';

export interface NavItem {
  /** Stable key. */
  id: string;
  label: string;
  /**
   * Full link target, including any app base path (compute it with the router
   * or `import.meta.env.BASE_URL`). Rendered as a plain `<a href>`.
   */
  href: string;
  icon?: CarbonIconType;
  /** 'main' (default) items stack at the top; 'footer' items sit at the bottom of the rail. */
  section?: 'main' | 'footer';
}

export interface SideNavRailProps {
  items: NavItem[];
  /** true = 256px rail with labels; false = 48px icon rail with tooltips. */
  expanded: boolean;
  /**
   * Current location, in the same form as the item hrefs (a pathname, or a
   * `#/...` hash for hash routing; query and fragment are ignored). An item is
   * active when it equals its `href` (a trailing slash on either side is
   * ignored) or starts with `href + '/'`; an `href` ending in `/`, such as a
   * home item `${BASE}/`, matches only its own path. When several match, the
   * longest `href` wins.
   */
  activeHref: string;
  /**
   * Called on a plain left-click (no modifier keys) with the default navigation
   * prevented, so the app can route client-side. Modified and middle clicks are
   * left to the browser (open in a new tab/window). Without `onNavigate` the
   * links navigate normally.
   */
  onNavigate?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /** Rendered at the very bottom of the rail, below any footer items. */
  footer?: ReactNode;
  /** Accessible name of the <nav> landmark. Default 'Side navigation'. */
  ariaLabel?: string;
  className?: string;
}

// '/runs/7?tab=events#top' -> '/runs/7'. A leading '#' is a hash-router path
// ('#/runs/7' -> '/runs/7'), not a fragment to drop.
function toPath(href: string): string {
  const path = href.startsWith('#') ? href.slice(1) : href;
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

// '/badger/' -> '/badger'; the root '/' stays '/'.
function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

function matches(href: string, pathname: string): boolean {
  if (withoutTrailingSlash(pathname) === withoutTrailingSlash(href)) return true;
  // An href ending in '/' (a home item such as `${BASE}/`, or '/') matches
  // only its own path; other hrefs also match the paths below them.
  return !href.endsWith('/') && pathname.startsWith(`${href}/`);
}

/** The id of the item that should render active: the longest matching href. */
export function findActiveNavItem(items: NavItem[], activeHref: string): string | undefined {
  const pathname = toPath(activeHref);
  let best: { id: string; length: number } | undefined;
  for (const item of items) {
    const href = toPath(item.href);
    if (matches(href, pathname) && (!best || href.length > best.length)) {
      best = { id: item.id, length: href.length };
    }
  }
  return best?.id;
}

function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    (!e.currentTarget.target || e.currentTarget.target === '_self')
  );
}

/**
 * Router-agnostic collapsible side navigation: a fixed rail under the header,
 * 256px expanded / 48px collapsed, on `--cds-layer`, with a 3px
 * `--cds-link-primary` left border on the active item.
 * Pair it with `AppHeader menu` and `AppShell sideNavExpanded`.
 */
export function SideNavRail({
  items,
  expanded,
  activeHref,
  onNavigate,
  footer,
  ariaLabel = 'Side navigation',
  className,
}: SideNavRailProps) {
  const activeId = findActiveNavItem(items, activeHref);
  const mainItems = items.filter((i) => (i.section ?? 'main') === 'main');
  const footerItems = items.filter((i) => i.section === 'footer');

  const renderItem = (item: NavItem) => {
    const active = item.id === activeId;
    const Icon = item.icon;
    const link = (
      <a
        href={item.href}
        className="canopy-rail__link"
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
          if (!onNavigate || !isPlainLeftClick(e)) return;
          e.preventDefault();
          onNavigate(item.href, e);
        }}
      >
        {Icon ? (
          <Icon size={20} className="canopy-rail__icon" aria-hidden="true" />
        ) : (
          <span className="canopy-rail__icon canopy-rail__icon--initial" aria-hidden="true">
            {item.label.charAt(0)}
          </span>
        )}
        {expanded && <span className="canopy-rail__label">{item.label}</span>}
      </a>
    );
    return (
      <li key={item.id} className="canopy-rail__item">
        {expanded ? (
          link
        ) : (
          <Tooltip label={item.label} align="right" className="canopy-rail__tooltip">
            {link}
          </Tooltip>
        )}
      </li>
    );
  };

  const classes = [
    'canopy-rail',
    expanded ? 'canopy-rail--expanded' : 'canopy-rail--collapsed',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav aria-label={ariaLabel} className={classes}>
      <ul className="canopy-rail__list">{mainItems.map(renderItem)}</ul>
      {(footerItems.length > 0 || footer != null) && (
        <div className="canopy-rail__footer">
          {footerItems.length > 0 && (
            <ul className="canopy-rail__list">{footerItems.map(renderItem)}</ul>
          )}
          {footer != null && <div className="canopy-rail__footer-slot">{footer}</div>}
        </div>
      )}
    </nav>
  );
}
