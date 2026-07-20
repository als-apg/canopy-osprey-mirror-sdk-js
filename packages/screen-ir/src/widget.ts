import type { Rule } from './rules.js';

/** Absolute pixel bounds in canvas coordinates. Absolute-only for v0.1. */
export interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Editor-facing annotations preserved across save; ignored by the runtime renderer. */
export interface WidgetMeta {
  readonly comment?: string;
}

/**
 * A widget property value. v0.1 ships only PropertyLiteral and macro strings —
 * macro substitution is detected via the widget's `propSchema`
 * (`format: "pv-channel" | "macro-string"`), not via the value.
 */
export type PropertyValue = PropertyLiteral | PropertyTagged;

export type PropertyLiteral =
  | string
  | number
  | boolean
  | null
  | readonly PropertyValue[]
  | { readonly [key: string]: PropertyValue };

/** Reserved tagged form, detected by the leading `$` key prefix. Unused in v0.1. */
export interface PropertyTagged {
  readonly [key: `$${string}`]: unknown;
}

export type Props = Readonly<Record<string, PropertyValue>>;

/**
 * One widget in the IR tree.
 *
 * - `id` is stable across saves; never regenerate on round-trip.
 * - `type` is the Canopy widget registry id (kebab-case, e.g. `"pv-label"`), never a Qt class name.
 * - Z-order is array order of `children` — later siblings render on top.
 * - Rules are inline, attached by `targetProperty`.
 * - `unknown-widget` is the converter's fallback when a Qt class has no registry entry.
 */
export interface WidgetNode {
  readonly id: string;
  readonly type: string;
  readonly props: Props;
  readonly geometry: Geometry;
  readonly children?: readonly WidgetNode[];
  readonly rules?: readonly Rule[];
  readonly meta?: WidgetMeta;
  /** Converter warnings that survive into the IR; surfaced as inline indicators in SB. */
  readonly warnings?: readonly string[];
}

/**
 * Fallback type emitted by the converter for Qt classes with no registry entry.
 * Original Qt props are preserved verbatim under `originalProps` so nothing is lost.
 */
export interface UnknownWidgetProps {
  readonly originalClass: string;
  readonly originalProps: Readonly<Record<string, unknown>>;
}
