import type { FormulaDeclaration } from './formula.js';
import type { MacroDeclaration } from './macros.js';
import type { WidgetNode } from './widget.js';

/** Bump on breaking change; minor bump on additive. */
export const SCHEMA_VERSION = '1.0' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

/**
 * `"screen"` is a directly-renderable screen. `"template"` is a parameterized
 * fragment that requires explicit macro values at instantiation — its
 * `MacroDeclaration`s must NOT have defaults.
 */
export type ScreenKind = 'screen' | 'template';

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where this screen came from; tooling/round-trip only, not needed at runtime.
 * `type` is `string` (not a union) because disposable converters stamp their own
 * source types (`"edl-converter"`, ...) that the editor must read forever. The
 * named variants exist for autocomplete, not as an exhaustive list.
 */
export type ScreenSource =
  | { readonly type: 'screen-builder'; readonly savedAt: string }
  | { readonly type: 'hand-authored' }
  | {
      readonly type: string;
      readonly savedAt?: string;
      readonly sourceFile?: string;
      readonly convertedAt?: string;
    };

export interface ScreenMetadata {
  readonly title: string;
  readonly source: ScreenSource;
  readonly size: ScreenSize;
  readonly description?: string;
  readonly author?: string;
}

/**
 * The canonical Canopy screen Intermediate Representation.
 *
 * Round-trip identity is a hard contract: open → save without edits → byte
 * (or at minimum semantically) identical output. Validators enforce this in
 * tests.
 */
export interface ScreenJSON {
  readonly schemaVersion: SchemaVersion;
  readonly kind: ScreenKind;
  readonly id: string;
  readonly metadata: ScreenMetadata;
  readonly macros: readonly MacroDeclaration[];
  /** Screen-level formulas, referenced by `formula://<name>` from channel props and rules. */
  readonly formulas?: readonly FormulaDeclaration[];
  readonly root: WidgetNode;
}
