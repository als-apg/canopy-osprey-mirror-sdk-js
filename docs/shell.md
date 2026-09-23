---
icon: lucide/panels-top-left
---

# App shell (`@slaclab/canopy-shell`)

The standard chrome for Canopy web apps: the SLAC-branded header, the light/dark
color mode, the page layout, and the feedback primitives every app needs. The
look follows react-squirrel after PR #181:

- a **"SLAC"** prefix and product name in SLAC red (`#901515`)
- a header that **follows the page theme**
- Carbon **g10** (light) and **g100** (dark)
- trailing actions in the order **app actions → theme → report bug → help**

The full API reference is the
[package README](https://github.com/slaclab/canopy-sdk-js/tree/main/packages/shell#readme).

## Setup

```ts title="main.tsx"
import '@carbon/styles/css/styles.css';
import '@slaclab/canopy-shell/styles.css';
import { configureColorMode } from '@slaclab/canopy-shell';

// Before the first render: where the choice is stored, and the first-visit mode.
configureColorMode({ storageKey: 'myapp.theme', defaultMode: 'light' });
```

```tsx title="Root layout"
<ColorModeTheme>
  <ToastProvider>
    <ConfirmProvider>
      <AppShell
        header={
          <AppHeader
            productName="Badger"
            fixed
            menu={{ open, onToggle }}
            themeToggle
            bugReportUrl={BUG_URL}
            helpUrl={DOCS_URL}
          />
        }
        sideNav={<SideNavRail items={NAV} expanded={open} activeHref={pathname} onNavigate={go} />}
        sideNavExpanded={open}
        banners={<Banners />}
      >
        <ErrorBoundary resetKeys={[pathname]}>
          <Outlet />
        </ErrorBoundary>
      </AppShell>
    </ConfirmProvider>
  </ToastProvider>
</ColorModeTheme>
```

## What's in the box

| Piece                                | Purpose                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `AppHeader`                          | Carbon header: prefix, name, `context`, hamburger `menu`, `actions`, theme toggle, bug report and help     |
| `ThemeToggleAction`                  | The Sun/Moon toggle on its own                                                                             |
| `useColorMode`, `configureColorMode` | Persisted light/dark store (lazy, storage errors swallowed, legacy-key migration)                          |
| `CARBON_THEME`, `ColorModeTheme`     | `{ light: 'g10', dark: 'g100' }` and the matching `<Theme>` root; `<html>` gets `data-theme` + `cds--g*`   |
| `AppShell`                           | Fixed header, optional rail, `<main id="main-content">` offset by header and rail, banners, scrolling body |
| `SideNavRail`, `NavItem`             | 256/48px collapsible rail of plain links; `onNavigate` for client-side routing                             |
| `ToastProvider`, `useToast`          | Stacked toasts top-right under the header; 5 s default, `0` = sticky                                       |
| `ConfirmProvider`, `useConfirm`      | `await confirm({ heading, body, danger })` returning a boolean                                             |
| `ErrorBoundary`, `ErrorFallback`     | Render-error fallback with "Try again" and "Reload"                                                        |

## Routing

The shell has no router dependency.

- **`SideNavRail` links** are plain `<a href>` elements whose `href` includes
  any base path.
- **`onNavigate(href, event)`** runs only for an unmodified left click, with the
  default navigation prevented. Hand the path to your router there. Modified
  and middle clicks still open new tabs.
- **Active matching** works by prefix: an item is active on its own `href` and
  on paths below it (`href + '/'`). When several items match, the longest one
  wins.
- **`AppHeader nameAs`** replaces the name's anchor with your link component.
  It receives `href`, so a router `Link` that wants `to` needs a small adapter:

```tsx
function HeaderLink({ href = '/', ...rest }: ComponentProps<'a'>) {
  return <Link to={href} {...rest} />; // TanStack Router
}
```

## Upgrading from 0.1

The 0.1 props (`title`, `toolbar`) still work, but the header's defaults
changed:

- it follows the page theme instead of always being dark
- it shows the "SLAC" prefix
- the name is SLAC red

To keep the old always-dark bar, pass `theme="g100" prefix=""`.

!!! warning "Brand contrast"

    SLAC red on the g100 header background is about 2:1, below WCAG AA. The
    shell ships react-squirrel's value unchanged. `styles.css` contains a
    commented-out dark-mode override (`--canopy-brand: #ff8389`) for apps that
    want AA contrast.
