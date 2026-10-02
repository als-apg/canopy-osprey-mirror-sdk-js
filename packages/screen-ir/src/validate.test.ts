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

  describe('rule positions', () => {
    const role = { $role: 'alarm.major', fallback: '#ff0000', fallbackDark: '#ff4040' };

    const withConditional = (value: unknown, dflt: unknown = '#000000') => ({
      ...minimal,
      root: {
        ...minimal.root,
        rules: [
          {
            id: 'r1',
            name: 'Color',
            targetProperty: 'foreground',
            default: dflt,
            pvs: [{ name: 'SIM:PV', trigger: true }],
            conditions: [{ expression: '{0} > 1', value }],
          },
        ],
      },
    });

    const withFormula = (dflt: unknown) => ({
      ...minimal,
      formulas: [{ name: 'f', expression: '1' }],
      root: {
        ...minimal.root,
        rules: [
          { id: 'r1', name: 'Color', targetProperty: 'foreground', default: dflt, formula: 'f' },
        ],
      },
    });

    it.each([
      ['string', '#00ff00'],
      ['number', 3],
      ['boolean', true],
      ['null', null],
    ])('still accepts a %s condition value', (_label, v) => {
      expect(validate(withConditional(v))).toEqual([]);
    });

    it('accepts a role in a condition value', () => {
      expect(validate(withConditional(role))).toEqual([]);
    });

    it('accepts a role as a conditional-arm default', () => {
      expect(validate(withConditional('#00ff00', role))).toEqual([]);
    });

    it('accepts a role without fallbackDark', () => {
      expect(validate(withConditional({ $role: 'ok', fallback: '#00ff0080' }))).toEqual([]);
    });

    it('accepts a scalar formula-arm default', () => {
      expect(validate(withFormula('#000000'))).toEqual([]);
    });

    it.each([
      ['a 65-character role', { $role: 'r'.repeat(65), fallback: '#000000' }],
      ['an empty role', { $role: '', fallback: '#000000' }],
      ['a #ff fallback', { $role: 'x', fallback: '#ff' }],
      ['a #ff fallbackDark', { $role: 'x', fallback: '#000000', fallbackDark: '#ff' }],
      ['an extra key', { $role: 'x', fallback: '#000000', extra: 1 }],
      ['a missing fallback', { $role: 'x' }],
    ])('rejects %s in a condition value', (_label, v) => {
      expect(validate(withConditional(v)).length).toBeGreaterThan(0);
    });

    it('rejects a bad role as a conditional-arm default', () => {
      expect(
        validate(withConditional('#00ff00', { $role: 'x', fallback: '#ff' })).length
      ).toBeGreaterThan(0);
    });

    it('rejects a role as a formula-arm default', () => {
      expect(validate(withFormula(role)).length).toBeGreaterThan(0);
    });
  });
});
