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
