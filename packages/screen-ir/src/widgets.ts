// IR widget types and their definitions, as published by slaclab/canopy-spec
// (spec/screen-ir/widgets). The list and the data come from
// widgets.generated.ts, which the spec sync writes.

import { IR_WIDGET_TYPES, WIDGET_DEFINITION_DATA } from './widgets.generated.js';

export { IR_WIDGET_TYPES };

/** An IR widget `type` the spec defines, e.g. `"pv-label"`. */
export type IRWidgetType = (typeof IR_WIDGET_TYPES)[number];

/** One `spec/screen-ir/widgets/<type>.json` file. */
export interface WidgetDefinition {
  readonly id: string;
  /** Semver of this definition; the major version changes on an incompatible propSchema change. */
  readonly version: string;
  readonly description: string;
  readonly supportsPv: boolean;
  readonly supportsRules: boolean;
  readonly supportsChildren: boolean;
  /**
   * JSON Schema (draft-07) describing the node's `props`. Descriptive only in
   * this spec version: don't validate props against it. Its `required` lists
   * and number types reject real screens (see the canopy-spec README).
   */
  readonly propSchema: Readonly<Record<string, unknown>>;
}

export const WIDGET_DEFINITIONS: Readonly<Record<IRWidgetType, WidgetDefinition>> =
  WIDGET_DEFINITION_DATA;
