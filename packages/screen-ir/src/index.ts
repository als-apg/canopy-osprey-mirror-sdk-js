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
  Action,
} from './widget.js';
export { isAction, readActions } from './widget.js';

export type { Rule, RulePvBinding, RuleCondition, RuleScalar, RuleValue } from './rules.js';

export type { ColorRole } from './colorRole.js';
export { isColorRole } from './colorRole.js';

export { validate } from './validate.js';
