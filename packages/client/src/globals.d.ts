// Minimal ambient declarations for runtime globals used by this package.
//
// tsconfig deliberately has no DOM lib and no @types/node (this package must
// stay usable from both browsers and Node without pulling in either type
// universe). Timers and `console` are supplied by every JS host at runtime
// but aren't declared by `lib.es2023.d.ts`, so we declare the minimal shape
// this package relies on here.

export {};

declare global {
  function setTimeout(handler: () => void, timeoutMs?: number): number;
  function clearTimeout(id: number | undefined): void;
  function setInterval(handler: () => void, intervalMs?: number): number;
  function clearInterval(id: number | undefined): void;

  const console: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}
