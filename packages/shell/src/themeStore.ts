import { useEffect, useSyncExternalStore } from 'react';

export type ColorMode = 'light' | 'dark';

/** Carbon theme per color mode, the SLAC standard: g10 for light, g100 for dark. */
export const CARBON_THEME = { light: 'g10', dark: 'g100' } as const satisfies Record<
  ColorMode,
  'g10' | 'g100'
>;
export type CarbonColorModeTheme = (typeof CARBON_THEME)[ColorMode];

export interface ColorModeConfig {
  /** localStorage key the choice is persisted under. Default 'canopy.theme'. */
  storageKey?: string;
  /** Mode used when nothing is stored yet. Default 'dark'. */
  defaultMode?: ColorMode;
  /**
   * Keys an app used before adopting the SDK store (e.g. 'trace.theme',
   * 'squirrel-color-mode'). Read once, in order, when `storageKey` holds
   * nothing; the first valid value is copied to `storageKey`.
   */
  legacyKeys?: string[];
}

const DEFAULT_CONFIG: Required<ColorModeConfig> = {
  storageKey: 'canopy.theme',
  defaultMode: 'dark',
  legacyKeys: [],
};

let config: Required<ColorModeConfig> = { ...DEFAULT_CONFIG };
// null = not read yet. The first read happens lazily (not at module load), so
// configureColorMode() can run before it and storage errors never break import.
let current: ColorMode | null = null;
const listeners = new Set<() => void>();

function isColorMode(v: unknown): v is ColorMode {
  return v === 'light' || v === 'dark';
}

// localStorage can be missing (SSR, workers) or throw (Safari private mode,
// disabled storage, sandboxed iframes); every access is guarded.
function storageGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice lasts for this page load only
  }
}

function readInitial(): ColorMode {
  const stored = storageGet(config.storageKey);
  if (isColorMode(stored)) return stored;
  for (const key of config.legacyKeys) {
    const legacy = storageGet(key);
    if (isColorMode(legacy)) {
      storageSet(config.storageKey, legacy);
      return legacy;
    }
  }
  return config.defaultMode;
}

function ensure(): ColorMode {
  if (current === null) current = readInitial();
  return current;
}

function publish() {
  for (const l of listeners) l();
}

/**
 * Configure the store. Call once at bootstrap, before the first render, e.g.
 * `configureColorMode({ storageKey: 'badger.theme', defaultMode: 'light' })`.
 * Calling it later re-reads storage under the new key and notifies subscribers.
 */
export function configureColorMode(next: ColorModeConfig): void {
  config = {
    storageKey: next.storageKey ?? config.storageKey,
    defaultMode: next.defaultMode ?? config.defaultMode,
    legacyKeys: next.legacyKeys ?? config.legacyKeys,
  };
  const prev = current;
  current = readInitial();
  if (prev !== null && prev !== current) publish();
}

export function getColorMode(): ColorMode {
  return ensure();
}

export function setColorMode(mode: ColorMode): void {
  if (mode === ensure()) return;
  current = mode;
  storageSet(config.storageKey, mode);
  publish();
}

export function toggleColorMode(): void {
  setColorMode(ensure() === 'dark' ? 'light' : 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CARBON_THEME_CLASSES = ['cds--white', 'cds--g10', 'cds--g90', 'cds--g100'];

/**
 * Mirror the mode onto <html>: `data-theme="light|dark"` for an app's plain CSS,
 * and the Carbon `cds--g10`/`cds--g100` class so content portaled outside the
 * app's <Theme> (modals, menus, tooltips, toasts) still gets the right tokens.
 */
export function syncDocumentColorMode(mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  const keep = `cds--${CARBON_THEME[mode]}`;
  for (const cls of CARBON_THEME_CLASSES) {
    if (cls !== keep) root.classList.remove(cls);
  }
  root.classList.add(keep);
}

export interface UseColorModeResult {
  colorMode: ColorMode;
  toggle: () => void;
  setColorMode: (mode: ColorMode) => void;
  /** The Carbon theme for the current mode (`CARBON_THEME[colorMode]`). */
  carbonTheme: CarbonColorModeTheme;
}

export function useColorMode(): UseColorModeResult {
  const colorMode = useSyncExternalStore(subscribe, getColorMode, getColorMode);
  useEffect(() => {
    syncDocumentColorMode(colorMode);
  }, [colorMode]);
  return {
    colorMode,
    toggle: toggleColorMode,
    setColorMode,
    carbonTheme: CARBON_THEME[colorMode],
  };
}

/** Test-only: restore the default config and forget the cached mode. */
export function resetColorModeForTests(): void {
  config = { ...DEFAULT_CONFIG };
  current = null;
  publish();
}
