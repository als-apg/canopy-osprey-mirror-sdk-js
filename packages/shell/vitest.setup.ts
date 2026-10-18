// Node 25+ defines its own global localStorage/sessionStorage, which are
// undefined unless Node is started with --localstorage-file. Vitest's jsdom
// environment does not overwrite globals that already exist, so Node's empty
// ones shadow jsdom's. Point both back at the jsdom window's storage.
const jsdomWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, key, {
    value: jsdomWindow[key],
    configurable: true,
    writable: true,
  });
}

// jsdom does not implement matchMedia; @carbon/react's Theme/Header/Tooltip
// components query it internally, so stub a minimal version before any test
// file imports Carbon. (Explicit cleanup() stays in each test file: without
// `test.globals`, @testing-library/react's auto-cleanup never registers.)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
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

// jsdom has no ResizeObserver either; Carbon's Modal observes its content.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
