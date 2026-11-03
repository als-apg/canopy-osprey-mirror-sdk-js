// canopy-spec conformance, level 2: every case agrees on whether the screen is
// valid, and every expected error is reported with the same rule id and JSON
// Pointer. Cases live in ../spec/conformance (copied from slaclab/canopy-spec).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDetailed } from './validate.js';
import type { ValidationRule } from './validate.js';

interface ConformanceCase {
  readonly description: string;
  readonly valid: boolean;
  readonly errors?: ReadonlyArray<{ readonly rule: ValidationRule; readonly instancePath: string }>;
  readonly screen: unknown;
}

const casesDir = fileURLToPath(new URL('../spec/conformance/screen-ir/validate', import.meta.url));
const cases = readdirSync(casesDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const c = JSON.parse(readFileSync(join(casesDir, name), 'utf8')) as ConformanceCase;
    return [name.slice(0, -'.json'.length), c] as const;
  });

describe('canopy-spec conformance (screen-ir/validate)', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', (_name, c) => {
    const reported = validateDetailed(c.screen);
    expect(reported.length === 0, `${c.description}\n${JSON.stringify(reported)}`).toBe(c.valid);
    for (const expected of c.errors ?? []) {
      expect(reported.map(({ rule, instancePath }) => ({ rule, instancePath }))).toContainEqual(
        expected
      );
    }
  });
});
