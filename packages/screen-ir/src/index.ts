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

export { IR_WIDGET_TYPES, WIDGET_DEFINITIONS } from './widgets.js';
export type { IRWidgetType, WidgetDefinition } from './widgets.js';

export { validate, validateDetailed } from './validate.js';
export type { ValidationError, ValidationRule } from './validate.js';
