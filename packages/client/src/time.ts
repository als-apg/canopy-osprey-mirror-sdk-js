// Epoch-nanosecond time helpers. Canopy's wire protocols share one time
// domain — Mole `from`/`to`, Formula Engine `t0Ns`/`t1Ns`, and Hare/Mole
// `tsNs` are all integer epoch nanoseconds — while JS works in epoch
// milliseconds.
//
// The ms→ns direction goes through BigInt so the arithmetic itself cannot
// lose precision; the result is returned as a plain number to match the wire
// DTOs. Note that present-day epoch nanoseconds (~1.8e18) exceed
// Number.MAX_SAFE_INTEGER (~9e15), so a number cannot represent every exact
// ns tick — treat these values as sub-microsecond-accurate timestamps, which
// is how Canopy's JSON APIs consume them.

const NS_PER_MS = 1_000_000n;

/** Current time as epoch nanoseconds (millisecond-accurate, from `Date.now()`). */
export function nowNs(): number {
  return Number(BigInt(Date.now()) * NS_PER_MS);
}

/** Epoch (or duration) milliseconds → nanoseconds. Fractional ms are truncated. */
export function msToNs(ms: number): number {
  return Number(BigInt(Math.trunc(ms)) * NS_PER_MS);
}

/** Epoch (or duration) nanoseconds → milliseconds, truncated toward zero. */
export function nsToMs(ns: number): number {
  return Math.trunc(ns / 1_000_000);
}

/** `Date` → epoch nanoseconds. */
export function dateToNs(date: Date): number {
  return msToNs(date.getTime());
}

/** Epoch nanoseconds → `Date` (millisecond resolution). */
export function nsToDate(ns: number): Date {
  return new Date(nsToMs(ns));
}
