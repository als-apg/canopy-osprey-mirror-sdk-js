import { describe, expect, it } from 'vitest';
import { isColorRole } from './index.js';
import type { ColorRole } from './index.js';

const accepted: [string, ColorRole][] = [
  ['role with fallback', { $role: 'alarm.major', fallback: '#ff0000' }],
  [
    'role with fallback and fallbackDark',
    { $role: 'bg', fallback: '#ffffff', fallbackDark: '#202020' },
  ],
  ['8-digit hex with alpha', { $role: 'x', fallback: '#ff000080' }],
  ['uppercase hex', { $role: 'x', fallback: '#ABCDEF' }],
  ['64-character role', { $role: 'r'.repeat(64), fallback: '#000000' }],
];

describe('isColorRole', () => {
  it.each(accepted)('accepts %s', (_label, v) => {
    expect(isColorRole(v)).toBe(true);
  });

  it.each([
    ['null', null],
    ['string', '#ff0000'],
    ['number', 3],
    ['array', [{ $role: 'x', fallback: '#000000' }]],
    ['missing $role', { fallback: '#000000' }],
    ['missing fallback', { $role: 'x' }],
    ['empty role', { $role: '', fallback: '#000000' }],
    ['65-character role', { $role: 'r'.repeat(65), fallback: '#000000' }],
    ['non-string role', { $role: 1, fallback: '#000000' }],
    ['short hex fallback', { $role: 'x', fallback: '#ff' }],
    ['3-digit hex fallback', { $role: 'x', fallback: '#fff' }],
    ['hex without #', { $role: 'x', fallback: 'ff0000' }],
    ['named color fallback', { $role: 'x', fallback: 'red' }],
    ['bad fallbackDark', { $role: 'x', fallback: '#000000', fallbackDark: '#ff' }],
    ['null fallbackDark', { $role: 'x', fallback: '#000000', fallbackDark: null }],
    ['extra key', { $role: 'x', fallback: '#000000', extra: 1 }],
  ])('rejects %s', (_label, v) => {
    expect(isColorRole(v)).toBe(false);
  });
});
