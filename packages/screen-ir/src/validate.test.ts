import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { SCHEMA_VERSION, MACRO_NAME_PATTERN } from './index.js';

const minimal = {
  schemaVersion: SCHEMA_VERSION,
  kind: 'screen',
  id: 's',
  metadata: { title: 'S', source: { type: 'hand-authored' }, size: { width: 100, height: 100 } },
  macros: [] as unknown[],
  root: {
    id: 'w-001',
    type: 'absolute-canvas',
    props: { width: 100, height: 100 },
    geometry: { x: 0, y: 0, width: 100, height: 100 },
  },
};

describe('@slaclab/canopy-screen-ir validate', () => {
  it('accepts a minimal valid screen', () => {
    expect(validate(minimal)).toEqual([]);
  });

  it('accepts lowercase/mixed-case macro names (canonical ^[A-Za-z] pattern)', () => {
    const screen = {
      ...minimal,
      macros: [
        { name: 'dev', default: '' },
        { name: 'signal', default: '' },
        { name: 'PREFIX', default: '' },
      ],
    };
    expect(validate(screen)).toEqual([]);
    expect(MACRO_NAME_PATTERN.test('dev')).toBe(true);
    expect(MACRO_NAME_PATTERN.test('PREFIX')).toBe(true);
    expect(MACRO_NAME_PATTERN.test('1bad')).toBe(false);
  });

  it('flags a macro name starting with a digit', () => {
    const screen = { ...minimal, macros: [{ name: '1BAD', default: '' }] };
    expect(validate(screen).length).toBeGreaterThan(0);
  });
});

describe('@slaclab/canopy-screen-ir validate: formula references', () => {
  const rule = { id: 'r-001', name: 'R', targetProperty: 'visible', default: false };
  const pvRule = (name: string) => ({
    ...rule,
    pvs: [{ name, trigger: true }],
    conditions: [{ expression: '{0} > 1', value: true }],
  });

  /** A screen declaring formula `sum`, with one child widget under the root. */
  const screenWith = (child: { props?: object; rules?: object[] }) => ({
    ...minimal,
    formulas: [{ name: 'sum', expression: 'A + B', bindings: { A: 'sim://a', B: 'sim://b' } }],
    root: {
      ...minimal.root,
      children: [
        { id: 'w-002', type: 'text-update', props: {}, geometry: minimal.root.geometry, ...child },
      ],
    },
  });

  it('accepts a declared formula:// reference in a widget prop', () => {
    expect(validate(screenWith({ props: { channel: 'formula://sum' } }))).toEqual([]);
  });

  it('flags an undeclared formula:// reference in a widget prop', () => {
    expect(validate(screenWith({ props: { channel: 'formula://missing' } }))).toEqual([
      "widget 'w-002' prop 'channel' references formula 'missing' but no formulas[] entry declares it",
    ]);
  });

  it('accepts a declared formula:// reference in a rule PV binding', () => {
    expect(validate(screenWith({ rules: [pvRule('formula://sum')] }))).toEqual([]);
  });

  it('flags an undeclared formula:// reference in a rule PV binding', () => {
    expect(validate(screenWith({ rules: [pvRule('formula://missing')] }))).toEqual([
      "rule 'r-001' on widget 'w-002' pv references formula 'missing' but no formulas[] entry declares it",
    ]);
  });

  it('resolves a bare-name Rule.formula against formulas[]', () => {
    expect(validate(screenWith({ rules: [{ ...rule, formula: 'sum' }] }))).toEqual([]);
  });

  it('flags an undeclared bare-name Rule.formula', () => {
    expect(validate(screenWith({ rules: [{ ...rule, formula: 'missing' }] }))).toEqual([
      "rule 'r-001' on widget 'w-002' references formula 'missing' but no formulas[] entry declares it",
    ]);
  });
});
