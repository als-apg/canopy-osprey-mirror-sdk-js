// @slaclab/canopy-screen-ir public surface.

export { SCHEMA_VERSION } from './screen.js';
export type {
  SchemaVersion,
  ScreenKind,
  ScreenSize,
  ScreenSource,
  ScreenMetadata,
  ScreenJSON,
} from './screen.js';

export { MACRO_NAME_PATTERN } from './macros.js';
export type { MacroDeclaration, MacroValues } from './macros.js';

export type { FormulaDeclaration, FormulaKind } from './formula.js';

export type {
  WidgetNode,
  Geometry,
  WidgetMeta,
  PropertyValue,
  PropertyLiteral,
  PropertyTagged,
  Props,
  UnknownWidgetProps,
} from './widget.js';

export type { Rule, RulePvBinding, RuleCondition } from './rules.js';

export { validate } from './validate.js';
