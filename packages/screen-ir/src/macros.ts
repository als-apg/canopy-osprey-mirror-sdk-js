// Accepts either case — Canopy's convention is uppercase, but PyDM/EDM sources
// author lowercase/mixed-case macros (${dev}, ${signal}), which the runtime
// resolver substitutes fine. Must equal the copied schema's
// MacroDeclaration.name pattern; spec.test.ts checks it.
export const MACRO_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Author-time declaration of a macro on a screen.
 *
 * - `default` is required for `kind: "screen"`, forbidden for `kind: "template"`.
 * - `name` must match {@link MACRO_NAME_PATTERN}.
 */
export interface MacroDeclaration {
  readonly name: string;
  readonly default?: string;
  readonly description?: string;
}

/**
 * Runtime macro values, supplied at instantiation. NEVER stored in the IR —
 * the IR holds templates; runtime resolves them to values.
 */
export type MacroValues = Readonly<Record<string, string>>;
