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
