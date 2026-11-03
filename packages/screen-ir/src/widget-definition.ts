// The shape of a spec/screen-ir/widgets/<type>.json file. Its own module so
// widgets.generated.ts can type its data without importing widgets.ts.

/** One widget definition file, with `id` typed as JSON imports type it. See `WidgetDefinition`. */
export interface WidgetDefinitionData {
  /** The IR `type` value; equals the file name. */
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
