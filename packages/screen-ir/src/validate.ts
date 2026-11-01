// Runtime validation of a screen document against the canonical Screen IR.
// Layered: (1) structural conformance to the JSON Schema
// (../schema/screen-ir.schema.json), then (2) the cross-field/cross-reference
// rules the schema can't express (macro defaults, formula:// resolution). So
// validate() is the FULL contract, not just the structural subset.

// Named import (not CJS default) so the class type survives NodeNext resolution.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

import { formulaName, isFormulaRef } from './formula.js';
import schema from '../schema/screen-ir.schema.json' with { type: 'json' };

// Lazily compiled on first validate() call so type-only consumers of the
// package barrel don't pay ajv's schema-compilation cost at import time.
let validateSchema: ValidateFunction | undefined;
function getValidator(): ValidateFunction {
  return (validateSchema ??= new Ajv2020({ allErrors: true, strict: false }).compile(schema));
}

/**
 * Validate a screen document. Returns human-readable error messages; empty means
 * it conforms to the full Screen IR contract.
 *
 * Read-tolerant by design: accepts the loose superset the editor must open
 * (converter output, hand-authored, older `source` types). Does not mutate input.
 */
export function validate(screen: unknown): string[] {
  const errors: string[] = [];
  const validateSchema = getValidator();

  if (!validateSchema(screen)) {
    for (const err of validateSchema.errors ?? []) {
      // An `if` error only restates that a branch failed; the branch's own
      // errors name the property and the reason.
      if (err.keyword === 'if') continue;
      const path = err.instancePath || '(root)';
      errors.push(`${path} ${err.message ?? 'is invalid'}`);
    }
    // Structural failures make the semantic checks below unreliable; stop here.
    return errors;
  }

  // Past the schema gate the shape is safe to inspect.
  const doc = screen as ScreenLike;

  checkMacroDefaults(doc, errors);
  checkFormulaRefs(doc, errors);

  return errors;
}

// --- Semantic checks the JSON Schema can't express ------------------------

/** `default` required on a `screen`, forbidden on a `template`. */
function checkMacroDefaults(doc: ScreenLike, errors: string[]): void {
  const kind = doc.kind ?? 'screen';
  for (const macro of doc.macros ?? []) {
    const hasDefault = macro.default !== undefined && macro.default !== null;
    if (kind === 'screen' && !hasDefault) {
      errors.push(`macro '${macro.name}' needs a default on a screen (kind='screen')`);
    }
    if (kind === 'template' && hasDefault) {
      errors.push(`macro '${macro.name}' must not declare a default on a template`);
    }
  }
}

/**
 * Every `formula://` reference (in calc-PV channel props, rule `pvs[].name`, and
 * `Rule.formula`) resolves to a declared `formulas[]` entry.
 */
function checkFormulaRefs(doc: ScreenLike, errors: string[]): void {
  const formulaNames = new Set((doc.formulas ?? []).map((f) => f.name));

  const requireFormula = (name: string, where: string): void => {
    if (!formulaNames.has(name)) {
      errors.push(`${where} references formula '${name}' but no formulas[] entry declares it`);
    }
  };

  const walk = (node: WidgetLike | undefined): void => {
    if (!node) return;

    for (const [key, value] of Object.entries(node.props ?? {})) {
      if (isFormulaRef(value))
        requireFormula(formulaName(value), `widget '${node.id}' prop '${key}'`);
    }

    for (const rule of node.rules ?? []) {
      // `formula`/`pvs[].name` are schema-typed as strings; the guards here are
      // defensive and would fail-open if a future schema edit loosened them.
      if (typeof rule.formula === 'string') {
        requireFormula(formulaName(rule.formula), `rule '${rule.id}' on widget '${node.id}'`);
      }
      for (const pv of rule.pvs ?? []) {
        if (isFormulaRef(pv.name))
          requireFormula(formulaName(pv.name), `rule '${rule.id}' on widget '${node.id}' pv`);
      }
    }

    for (const child of node.children ?? []) walk(child);
  };

  walk(doc.root);
}

// --- Minimal structural shapes for post-schema inspection -----------------
// Intentionally loose — the schema gate already ran; these only cover what the
// semantic checks touch.

interface ScreenLike {
  readonly kind?: 'screen' | 'template';
  readonly macros?: ReadonlyArray<{ readonly name: string; readonly default?: unknown }>;
  readonly formulas?: ReadonlyArray<{ readonly name: string }>;
  readonly root?: WidgetLike;
}

interface RuleLike {
  readonly id: string;
  readonly formula?: unknown;
  readonly pvs?: ReadonlyArray<{ readonly name?: unknown }>;
}

interface WidgetLike {
  readonly id: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly rules?: readonly RuleLike[];
  readonly children?: readonly WidgetLike[];
}
