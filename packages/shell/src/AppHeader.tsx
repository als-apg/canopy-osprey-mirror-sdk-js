import type { ElementType, ReactNode } from 'react';
import {
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SkipToContent,
  Theme,
} from '@carbon/react';
import { Debug, Help, Moon, Sun } from '@carbon/icons-react';
import { useColorMode } from './themeStore.js';

/** 'inherit' follows the surrounding Carbon <Theme>; the rest force a theme on the bar. */
export type HeaderTheme = 'inherit' | 'white' | 'g10' | 'g90' | 'g100';

export interface AppHeaderMenu {
  /** Whether the side nav the hamburger controls is open. */
  open: boolean;
  onToggle: () => void;
  /** aria-label while closed. Default 'Open menu'. */
  openLabel?: string;
  /** aria-label while open. Default 'Close menu'. */
  closeLabel?: string;
}

export interface AppHeaderProps {
  /** Product name, e.g. "Badger". */
  productName?: string;
  /** @deprecated since 0.2 — alias of `productName` (kept so 0.1 call sites compile). */
  title?: string;
  /** Carbon prefix slot, rendered in SLAC brand red. Default "SLAC"; pass "" to hide. */
  prefix?: string;
  /**
   * Prefix and name in SLAC brand red (`--canopy-brand`). Default true; false
   * keeps Carbon's own header text color (with `theme="g100" prefix=""`, the
   * 0.1 look).
   */
  brandColor?: boolean;
  /** Rendered as " · {context}" after the name (an instance or deployment name). */
  context?: string;
  /** Name link target. Default '#'. With `nameAs`, it is passed to that component as `href`. */
  href?: string;
  /**
   * Component rendered for the name link instead of `<a>` (Carbon's `as`), e.g. a
   * router link. It receives `href`, `className` and `children`; a router whose
   * link wants `to` needs a small adapter (see the README).
   */
  nameAs?: ElementType;
  /** 'inherit' (default) follows the surrounding <Theme>; 'g100' = the 0.1 always-dark bar. */
  theme?: HeaderTheme;
  /** true = Carbon's fixed header (content needs a 3rem top offset; AppShell does this). Default false = in-flow. */
  fixed?: boolean;
  /** Skip-link target, or false to omit it. Default '#main-content' (the app must render that id). */
  skipToContent?: string | false;
  /** Hamburger for an app side nav (always visible when provided). */
  menu?: AppHeaderMenu;
  /** App-specific HeaderGlobalActions, rendered BEFORE the standard trailing actions. */
  actions?: ReactNode;
  /** @deprecated since 0.2 — alias of `actions`. */
  toolbar?: ReactNode;
  /**
   * Standard theme toggle wired to the SDK color-mode store. Default false.
   * `{ shortcut: 'Alt+T' }` appends " (Alt+T)" to its label (the app owns the key binding).
   */
  themeToggle?: boolean | { shortcut?: string };
  /** Standard "Report a bug" action: URL opened in a new tab... */
  bugReportUrl?: string;
  /** ...or a handler (wins over `bugReportUrl`; e.g. Tauri's shell.open). */
  onReportBug?: () => void;
  /** Standard "Help" action: URL opened in a new tab... */
  helpUrl?: string;
  /** ...or a handler (wins over `helpUrl`; e.g. a docs window). */
  onHelp?: () => void;
  /** Label of the help action. Default 'Help'. */
  helpLabel?: string;
  /** Middle slot between the name and the global bar (status text, counts, ...). */
  children?: ReactNode;
  /** Extra class on the Carbon <Header>. */
  className?: string;
}

function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export interface ThemeToggleActionProps {
  /** Appended to the label as " (shortcut)", e.g. 'Alt+T'. */
  shortcut?: string;
}

/**
 * The standard theme toggle: a HeaderGlobalAction showing Sun in dark mode and
 * Moon in light mode, labelled "Switch to light mode" / "Switch to dark mode".
 * Usable on its own inside any HeaderGlobalBar.
 */
export function ThemeToggleAction({ shortcut }: ThemeToggleActionProps = {}) {
  const { colorMode, toggle } = useColorMode();
  const base = colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <HeaderGlobalAction
      aria-label={shortcut ? `${base} (${shortcut})` : base}
      tooltipAlignment="end"
      onClick={toggle}
    >
      {colorMode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
    </HeaderGlobalAction>
  );
}

/**
 * The standard SLAC app header (react-squirrel #181 look): "SLAC" prefix and
 * product name in brand red, header following the page theme, and the trailing
 * actions in the order app actions → theme toggle → report bug → help.
 */
export function AppHeader(props: AppHeaderProps) {
  const {
    productName,
    title,
    prefix = 'SLAC',
    brandColor = true,
    context,
    href = '#',
    nameAs,
    theme = 'inherit',
    fixed = false,
    skipToContent = '#main-content',
    menu,
    actions,
    toolbar,
    themeToggle = false,
    bugReportUrl,
    onReportBug,
    helpUrl,
    onHelp,
    helpLabel = 'Help',
    children,
    className,
  } = props;

  const name = productName ?? title ?? '';
  const reportBug = onReportBug ?? (bugReportUrl ? () => openInNewTab(bugReportUrl) : undefined);
  const help = onHelp ?? (helpUrl ? () => openInNewTab(helpUrl) : undefined);
  const classes = [
    'canopy-header',
    brandColor && 'canopy-header--brand',
    fixed && 'canopy-header--fixed',
    menu && 'canopy-header--with-menu',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const header = (
    <Header aria-label={name} className={classes}>
      {skipToContent !== false && <SkipToContent href={skipToContent} />}
      {menu && (
        <HeaderMenuButton
          aria-label={
            menu.open ? (menu.closeLabel ?? 'Close menu') : (menu.openLabel ?? 'Open menu')
          }
          isActive={menu.open}
          isCollapsible
          onClick={menu.onToggle}
        />
      )}
      <HeaderName href={href} as={nameAs} prefix={prefix} className="canopy-header__name">
        {context ? `${name} · ${context}` : name}
      </HeaderName>
      {children}
      <HeaderGlobalBar>
        {actions ?? toolbar}
        {themeToggle && (
          <ThemeToggleAction
            shortcut={typeof themeToggle === 'object' ? themeToggle.shortcut : undefined}
          />
        )}
        {reportBug && (
          <HeaderGlobalAction aria-label="Report a bug" tooltipAlignment="end" onClick={reportBug}>
            <Debug size={20} />
          </HeaderGlobalAction>
        )}
        {help && (
          <HeaderGlobalAction aria-label={helpLabel} tooltipAlignment="end" onClick={help}>
            <Help size={20} />
          </HeaderGlobalAction>
        )}
      </HeaderGlobalBar>
    </Header>
  );

  return theme === 'inherit' ? header : <Theme theme={theme}>{header}</Theme>;
}
