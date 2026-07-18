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
