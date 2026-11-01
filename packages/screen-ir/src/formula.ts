/** `"scalar"` is a single computed value; `"timeseries"`/`"waveform"` are array-valued. */
export type FormulaKind = 'scalar' | 'timeseries' | 'waveform';

/**
 * A named screen-level formula evaluated by Canopy's Formula Engine.
 *
 * Formulas are referenced by name via the `formula://<name>` convention — from a
 * widget's channel prop (a "calc PV"), from a rule's PV binding
 * (`pvs[].name = "formula://<name>"`), or from a formula-driven rule
 * (`Rule.formula = "<name>"`). The reference is always just the name; the
 * `formula://` prefix marks it as a formula rather than a PV.
 *
 * `bindings` maps the placeholder names used in `expression` (e.g. `A`, `B`) to
 * the PV channels that feed them. Shape-compatible with the Formula Engine's `FormulaSpec`.
 */
export interface FormulaDeclaration {
  readonly name: string;
  /** Defaults to `"scalar"` when omitted. */
  readonly kind?: FormulaKind;
  readonly expression: string;
  readonly bindings?: Readonly<Record<string, string>>;
}

/** Marks a value as a formula reference rather than a PV. */
export const FORMULA_PREFIX = 'formula://';

/** Whether `value` is a `formula://` reference. */
export function isFormulaRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FORMULA_PREFIX);
}

/** The bare name, with the `formula://` prefix stripped if present. */
export function formulaName(ref: string): string {
  return ref.startsWith(FORMULA_PREFIX) ? ref.slice(FORMULA_PREFIX.length) : ref;
}
