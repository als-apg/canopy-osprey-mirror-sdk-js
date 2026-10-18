/**
 * Axis tick label. Numbers like 0.000000018 produce very wide tick labels
 * that spill past neighbouring axes, so switch to exponential at the
 * magnitudes where the default Number→string stops being compact.
 */
export function formatAxisTick(v: number): string {
  if (v === 0) return '0';
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e6) return v.toExponential(1);
  return String(v);
}

// "1.500e-5" -> "1.5e-5", "2.000e+7" -> "2e+7"
function trimExponential(s: string): string {
  return s.replace(/\.?0+e/, 'e');
}

/**
 * Display a value in tooltips and tables: `digits` significant digits,
 * exponential below 1e-3 or at/above 1e7, with trailing zeros trimmed. Non-numbers are stringified; null/undefined → ''.
 */
export function formatValue(v: unknown, digits = 7): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const precision = Math.min(Math.max(Math.trunc(digits), 1), 21);
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e7) {
    return trimExponential(v.toExponential(Math.max(precision - 1, 0)));
  }
  // Number(...) drops the trailing zeros toPrecision pads with.
  return String(Number(v.toPrecision(precision)));
}
