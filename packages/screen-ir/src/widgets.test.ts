// The widget-definition API: every id equals its key, the data is deep-frozen,
// and IRWidgetType stays a union of the spec's types rather than `string`.

import { describe, expect, it } from 'vitest';

import { IR_WIDGET_TYPES, WIDGET_DEFINITIONS } from './widgets.js';
import type { IRWidgetType } from './widgets.js';

/** `value` and every object and array inside it. */
function containers(value: unknown): object[] {
  if (typeof value !== 'object' || value === null) return [];
  return [value, ...Object.values(value).flatMap(containers)];
}

describe('WIDGET_DEFINITIONS', () => {
  it.each([...IR_WIDGET_TYPES])('%s has its key as id', (type) => {
    expect(WIDGET_DEFINITIONS[type].id).toBe(type);
  });

  it('is deep-frozen, arrays included', () => {
    const all = containers(WIDGET_DEFINITIONS);
    expect(all.some(Array.isArray)).toBe(true);
    expect(all.filter((container) => !Object.isFrozen(container))).toEqual([]);
  });

  it('throws on writes', () => {
    const definition = WIDGET_DEFINITIONS['pv-label'] as { description: string };
    expect(() => {
      definition.description = 'changed';
    }).toThrow(TypeError);
    const array = containers(WIDGET_DEFINITIONS).find(Array.isArray) as unknown[];
    expect(() => array.push('x')).toThrow(TypeError);
  });

  it('is keyed by IRWidgetType', () => {
    const type: IRWidgetType = 'pv-label';
    expect(WIDGET_DEFINITIONS[type].supportsPv).toBe(true);
    // @ts-expect-error -- not a widget type the spec defines
    expect(WIDGET_DEFINITIONS['not-a-widget']).toBeUndefined();
  });
});

describe('IR_WIDGET_TYPES', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(IR_WIDGET_TYPES)).toBe(true);
    expect(() => (IR_WIDGET_TYPES as unknown as string[]).push('x')).toThrow(TypeError);
  });
});
