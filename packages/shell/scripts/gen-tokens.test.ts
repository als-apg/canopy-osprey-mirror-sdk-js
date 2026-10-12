import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTokens,
  CONTRACT,
  PATHS,
  parseStylesheet,
  readCarbonStylesheet,
  serialize,
  ZONES,
} from './gen-tokens.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(SCRIPTS_DIR, 'gen-tokens.mjs');

type Zone = 'white' | 'g10' | 'g90' | 'g100';
type Edit = (declarations: Map<string, string>, zone: Zone) => void;

/** Carbon tokens the contract aliases, with a distinct literal per zone. */
const SOURCES = [
  'background',
  'layer-01',
  'layer-02',
  'field-01',
  'text-primary',
  'text-secondary',
  'text-helper',
  'border-subtle-00',
  'border-strong-01',
  'interactive',
  'text-on-color',
  'button-primary-hover',
  'layer-hover-01',
  'focus',
  'support-success',
  'support-warning',
  'support-error',
];

const ZONE_DIGIT: Record<Zone, string> = { white: '1', g10: '2', g90: '3', g100: '4' };

function zoneDeclarations(zone: Zone): Map<string, string> {
  const d = ZONE_DIGIT[zone];
  const declarations = new Map<string, string>();
  SOURCES.forEach((name, i) => {
    declarations.set(`--cds-${name}`, `#${d}${i.toString(16).padStart(2, '0')}abc`);
  });
  // An rgba literal, which must come through verbatim.
  declarations.set('--cds-layer-selected-01', `rgba(141, 141, 141, 0.${d})`);
  declarations.set('--cds-toggle-off', '#8d8d8d');
  declarations.set('--cds-content-switcher-selected', '#ffffff');
  declarations.set('--cds-button-danger-primary', '#da1e28');
  declarations.set('--cds-button-separator', '#e0e0e0');
  declarations.set('--cds-layer', `var(--cds-layer-01, #${d}11111)`);
  declarations.set('--cds-field', `var(--cds-field-01, #${d}22222)`);
  declarations.set('--cds-border-subtle', `var(--cds-border-subtle-00, #${d}33333)`);
  // Declared in the two light zones only, as Carbon does with notification-action-hover.
  if (zone === 'white' || zone === 'g10') declarations.set('--cds-light-only', '#0050e6');
  for (let i = 0; i < 200; i += 1) declarations.set(`--cds-filler-${i}`, `#${d}0${i % 10}000`);
  return declarations;
}

/** A stand-in for `@carbon/styles/css/styles.css`, held inline: no fixture file. */
function stylesheet(edit: Edit = () => {}): string {
  const blocks = (['white', 'g10', 'g90', 'g100'] as const).map((zone) => {
    const declarations = zoneDeclarations(zone);
    edit(declarations, zone);
    const lines = [...declarations].map(([name, value]) => `  ${name}: ${value};`);
    return [
      `.cds--${zone} {`,
      '  background-color: var(--cds-background);',
      '  color: var(--cds-text-primary);',
      ...lines,
      '}',
    ].join('\n');
  });
  return `:root {
  --cds-layout-size-height-xs: 1.5rem;
  --cds-layout-size-height-sm: 2rem;
  --cds-layout-size-height-md: 2.5rem;
}

${blocks.join('\n\n')}

.cds--g100 .cds--btn {
  --cds-layout-size-height-sm: 3rem;
  --cds-interactive: #000000;
}

.cds--btn {
  font-size: var(--cds-body-compact-01-font-size, 0.875rem);
  min-block-size: var(--cds-layout-size-height-sm);
}

.cds--label {
  font-size: var(--cds-label-01-font-size, 0.75rem);
  color: var(--cds-text-secondary);
}

.cds--snippet code {
  font-family: var(--cds-code-01-font-family, 'IBM Plex Mono', monospace);
  font-size: var(--cds-code-01-font-size, 0.75rem);
}

.cds--tag {
  font-size: var(--cds-label-01-font-size, 0.75rem);
  --cds-unread-font-size: 2rem;
}
`;
}

describe('parseStylesheet', () => {
  it('enumerates the declarations of each of the four zone blocks', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(Object.keys(parsed.zones)).toEqual(['white', 'g10', 'g90', 'g100']);
    expect(parsed.zones.white.size).toBe(226);
    expect(parsed.zones.g100.size).toBe(225);
    expect(parsed.zones.g90.get('--cds-interactive')).toBe('#309abc');
    // Non-token declarations of the block are not enumerated.
    expect(parsed.zoneTokens.every((name: string) => name.startsWith('--cds-'))).toBe(true);
  });

  it('reads the zone block, not a descendant rule that names the zone class', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(parsed.zones.g100.get('--cds-interactive')).toBe('#409abc');
    expect(parsed.zones.g100.has('--cds-layout-size-height-sm')).toBe(false);
  });

  it('enumerates the union, keeping a token declared in only two of the four blocks', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(parsed.zoneTokens).toContain('--cds-light-only');
    expect(parsed.zoneTokens).toHaveLength(226);
    expect(parsed.zoneTokens).toEqual([...parsed.zoneTokens].sort());
    expect(ZONES.filter((zone: Zone) => parsed.zones[zone].has('--cds-light-only'))).toEqual([
      'white',
      'g10',
    ]);
  });

  it('marks a var() value that derives from a -0x token as a context alias', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(parsed.aliases).toEqual({
      '--cds-layer': '--cds-layer-01',
      '--cds-field': '--cds-field-01',
      '--cds-border-subtle': '--cds-border-subtle-00',
    });
  });

  it.each([
    ['a token without a level suffix', 'var(--cds-interactive, #0f62fe)'],
    ['a level outside 00-03', 'var(--cds-layer-04, #0f62fe)'],
    ['no fallback literal', 'var(--cds-layer-01)'],
    ['a nested var()', 'var(--cds-layer-01, var(--cds-layer-02, #fff))'],
    ['a second var() after the alias', 'var(--cds-layer-01, #fff) var(--cds-layer-02, #000)'],
    ['var() inside a function', 'color-mix(in srgb, var(--cds-layer-01, #fff), #000)'],
  ])('refuses a var() value with %s', (_case, value) => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'g90') declarations.set('--cds-odd', value);
    });

    expect(() => parseStylesheet(css)).toThrow(/--cds-odd in \.cds--g90 .*unsupported var\(\)/);
  });

  it('accepts a context alias whose fallback literal is an rgba()', () => {
    const css = stylesheet((declarations) => {
      declarations.set('--cds-layer-hover', 'var(--cds-layer-hover-01, rgba(141, 141, 141, 0.16))');
    });

    expect(parseStylesheet(css).aliases['--cds-layer-hover']).toBe('--cds-layer-hover-01');
  });

  it('refuses a context alias that derives from different tokens in two zones', () => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'g100') declarations.set('--cds-layer', 'var(--cds-layer-02, #262626)');
    });

    expect(() => parseStylesheet(css)).toThrow(/--cds-layer derives from --cds-layer-01/);
  });

  it('collects the type tokens the stylesheet reads through var(), once each', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(parsed.typeTokens).toEqual([
      '--cds-body-compact-01-font-size',
      '--cds-code-01-font-family',
      '--cds-code-01-font-size',
      '--cds-label-01-font-size',
    ]);
  });

  it('reads the two layout constants from :root only', () => {
    const parsed = parseStylesheet(stylesheet());

    expect(parsed.layout).toEqual({
      '--cds-layout-size-height-xs': '1.5rem',
      '--cds-layout-size-height-sm': '2rem',
    });
  });

  it('refuses a stylesheet whose :root lacks a layout constant', () => {
    const css = stylesheet().replace('  --cds-layout-size-height-xs: 1.5rem;\n', '');

    expect(() => parseStylesheet(css)).toThrow(/--cds-layout-size-height-xs is not declared/);
  });

  it('refuses a stylesheet with a zone block missing', () => {
    const css = stylesheet().replace('.cds--g10 {', '.cds--g11 {');

    expect(() => parseStylesheet(css)).toThrow(/expected one \.cds--g10 block .* found 0/);
  });

  it('refuses a zone block with fewer than 200 declarations', () => {
    const css = stylesheet((declarations, zone) => {
      if (zone !== 'g90') return;
      for (let i = 0; i < 200; i += 1) declarations.delete(`--cds-filler-${i}`);
    });

    expect(() => parseStylesheet(css)).toThrow(/expected one \.cds--g90 block .* found 0/);
  });

  it('refuses a stylesheet with two full blocks for one zone', () => {
    const css = stylesheet();
    const block = css.slice(css.indexOf('.cds--g10 {'), css.indexOf('.cds--g90 {'));

    expect(() => parseStylesheet(css + block)).toThrow(/expected one \.cds--g10 block .* found 2/);
  });

  it.each([
    '--cds-button-primary-hover',
    '--cds-toggle-off',
    '--cds-content-switcher-selected',
    '--cds-button-danger-primary',
    '--cds-button-separator',
  ])('refuses a zone that lost the sentinel %s', (sentinel) => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'g10') declarations.delete(sentinel);
    });

    expect(() => parseStylesheet(css)).toThrow(`sentinel ${sentinel} is missing from .cds--g10`);
  });

  it('refuses a border-subtle that moved off border-subtle-00', () => {
    const css = stylesheet((declarations) => {
      declarations.set('--cds-border-subtle', 'var(--cds-border-subtle-01, #c6c6c6)');
    });

    expect(() => parseStylesheet(css)).toThrow(
      /--cds-border-subtle in \.cds--white no longer derives from --cds-border-subtle-00/
    );
  });

  it('refuses a border-subtle that became a plain literal', () => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'g100') declarations.set('--cds-border-subtle', '#393939');
    });

    expect(() => parseStylesheet(css)).toThrow(/--cds-border-subtle in \.cds--g100 no longer/);
  });
});

describe('buildTokens', () => {
  const NAMES = [
    'font-ui',
    'font-mono',
    'text-sm',
    'text-md',
    'text-lg',
    'radius-sm',
    'radius-md',
    'control-h-xs',
    'control-h-sm',
    'bg-base',
    'bg-panel',
    'bg-elevated',
    'bg-field',
    'text-primary',
    'text-secondary',
    'text-muted',
    'border',
    'border-strong',
    'accent',
    'on-accent',
    'accent-hover',
    'accent-tint',
    'hover-tint',
    'focus',
    'status-success',
    'status-warning',
    'status-error',
  ];

  it('lists the 27 contract names in their published order', () => {
    const tokens = buildTokens(parseStylesheet(stylesheet()));

    expect(Object.keys(tokens.names)).toEqual(NAMES);
    expect(CONTRACT.map(([name]: [string]) => name)).toEqual(NAMES);
    expect(tokens.contract).toBe(1);
    expect(tokens.zones).toEqual(['white', 'g10', 'g90', 'g100']);
  });

  it('gives a colour name its alias source and that token literal in each zone', () => {
    const tokens = buildTokens(parseStylesheet(stylesheet()));

    expect(tokens.names.accent).toEqual({
      alias: 'interactive',
      literals: { white: '#109abc', g10: '#209abc', g90: '#309abc', g100: '#409abc' },
    });
    expect(tokens.names['bg-base'].alias).toBe('background');
    expect(tokens.names['bg-panel'].alias).toBe('layer-01');
    expect(tokens.names['bg-elevated'].alias).toBe('layer-02');
    expect(tokens.names['bg-field'].alias).toBe('field-01');
    expect(tokens.names['text-muted'].alias).toBe('text-helper');
    expect(tokens.names.border.alias).toBe('border-subtle-00');
    expect(tokens.names['border-strong'].alias).toBe('border-strong-01');
    expect(tokens.names['on-accent'].alias).toBe('text-on-color');
    expect(tokens.names['accent-hover'].alias).toBe('button-primary-hover');
    expect(tokens.names['hover-tint'].alias).toBe('layer-hover-01');
    expect(tokens.names['status-error'].alias).toBe('support-error');
  });

  it('emits an rgba literal verbatim', () => {
    const tokens = buildTokens(parseStylesheet(stylesheet()));

    expect(tokens.names['accent-tint']).toEqual({
      alias: 'layer-selected-01',
      literals: {
        white: 'rgba(141, 141, 141, 0.1)',
        g10: 'rgba(141, 141, 141, 0.2)',
        g90: 'rgba(141, 141, 141, 0.3)',
        g100: 'rgba(141, 141, 141, 0.4)',
      },
    });
  });

  it('gives the nine non-colour names one fixed literal and no alias', () => {
    const tokens = buildTokens(parseStylesheet(stylesheet()));
    const fixed = Object.fromEntries(
      NAMES.slice(0, 9).map((name) => [name, tokens.names[name].literals.white])
    );

    expect(fixed).toEqual({
      'font-ui': "'IBM Plex Sans', system-ui, sans-serif",
      'font-mono': "'IBM Plex Mono', monospace",
      'text-sm': '0.75rem',
      'text-md': '0.875rem',
      'text-lg': '1rem',
      'radius-sm': '0',
      'radius-md': '0',
      'control-h-xs': '1.5rem',
      'control-h-sm': '2rem',
    });
    for (const name of NAMES.slice(0, 9)) {
      expect(tokens.names[name].alias).toBeNull();
      expect(new Set(Object.values(tokens.names[name].literals)).size).toBe(1);
      expect(Object.keys(tokens.names[name].literals)).toEqual(['white', 'g10', 'g90', 'g100']);
    }
  });

  it('refuses a contract name whose alias source is missing from a zone', () => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'g90' || zone === 'g100') declarations.delete('--cds-layer-hover-01');
    });

    expect(() => buildTokens(parseStylesheet(css))).toThrow(
      'hover-tint aliases --cds-layer-hover-01, which .cds--g90 does not declare'
    );
  });

  it('refuses an alias source that is itself a context alias', () => {
    const css = stylesheet((declarations, zone) => {
      if (zone === 'white') declarations.set('--cds-focus', 'var(--cds-focus-01, #0f62fe)');
    });

    expect(() => buildTokens(parseStylesheet(css))).toThrow(
      /focus aliases --cds-focus, which is itself an alias in \.cds--white/
    );
  });

  it('refuses a control height that no longer equals the Carbon layout constant', () => {
    const css = stylesheet().replace(
      '--cds-layout-size-height-sm: 2rem;\n  --cds-layout-size-height-md',
      '--cds-layout-size-height-sm: 2.25rem;\n  --cds-layout-size-height-md'
    );

    expect(() => buildTokens(parseStylesheet(css))).toThrow(
      'control-h-sm is fixed at 2rem but --cds-layout-size-height-sm is 2.25rem'
    );
  });

  it('serializes as two-space JSON with a trailing newline', () => {
    const text = serialize({ a: { b: 1 } });

    expect(text).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });
});

describe('the generator as a script', () => {
  const made: string[] = [];

  /** A package directory holding a copy of the generator and a `@carbon/styles` it resolves. */
  function tempPackage(css: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gen-tokens-')));
    made.push(dir);
    const carbon = join(dir, 'node_modules', '@carbon', 'styles');
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(carbon, 'css'), { recursive: true });
    copyFileSync(GENERATOR, join(dir, 'scripts', 'gen-tokens.mjs'));
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(
      join(carbon, 'package.json'),
      '{ "name": "@carbon/styles", "version": "0.0.0" }\n'
    );
    writeFileSync(join(carbon, 'css', 'styles.css'), css);
    return dir;
  }

  function run(dir: string, args: string[] = []): { status: number; stderr: string } {
    try {
      execFileSync(process.execPath, [join(dir, 'scripts', 'gen-tokens.mjs'), ...args], {
        cwd: tmpdir(),
        stdio: 'pipe',
      });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status: number; stderr: Buffer };
      return { status: failure.status, stderr: failure.stderr.toString() };
    }
  }

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes tokens.json beside its own package, whatever the working directory', () => {
    const css = stylesheet();
    const dir = tempPackage(css);
    const strayOutput = join(tmpdir(), 'tokens.json');
    const strayBefore = existsSync(strayOutput) ? readFileSync(strayOutput, 'utf8') : null;

    expect(run(dir)).toEqual({ status: 0, stderr: '' });

    expect(readFileSync(join(dir, 'tokens.json'), 'utf8')).toBe(
      serialize(buildTokens(parseStylesheet(css)))
    );
    expect(readdirSync(dir).sort()).toEqual([
      'node_modules',
      'package.json',
      'scripts',
      'tokens.json',
    ]);
    // Nothing was written into the working directory.
    expect(existsSync(strayOutput) ? readFileSync(strayOutput, 'utf8') : null).toBe(strayBefore);
  });

  it('parses the @carbon/styles its own package resolves, not this package', () => {
    const dir = tempPackage(
      stylesheet((declarations, zone) => {
        if (zone === 'g100') declarations.set('--cds-interactive', '#123456');
      })
    );

    expect(run(dir).status).toBe(0);

    const tokens = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
    expect(tokens.names.accent.literals.g100).toBe('#123456');
  });

  it('exits non-zero, names the fault and writes nothing when the stylesheet is refused', () => {
    const dir = tempPackage(
      stylesheet((declarations) => {
        declarations.delete('--cds-toggle-off');
      })
    );

    const result = run(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gen-tokens: sentinel --cds-toggle-off is missing');
    expect(existsSync(join(dir, 'tokens.json'))).toBe(false);
  });

  it('refuses an argument it does not know', () => {
    const dir = tempPackage(stylesheet());

    const result = run(dir, ['--frobnicate']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gen-tokens: unknown argument --frobnicate');
    expect(existsSync(join(dir, 'tokens.json'))).toBe(false);
  });

  it('resolves its three artefact paths from its own package directory', () => {
    const packageDir = dirname(SCRIPTS_DIR);

    expect(PATHS).toEqual({
      tokens: join(packageDir, 'tokens.json'),
      wiring: join(packageDir, 'wiring.json'),
      sheet: join(packageDir, 'host-contract.css'),
    });
  });
});

// Read-only: these cases never run the generator in write mode against this package.
describe('the pinned @carbon/styles', () => {
  it('declares the zone tokens the contract was written against', () => {
    const parsed = parseStylesheet(readCarbonStylesheet());

    expect(ZONES.map((zone: Zone) => parsed.zones[zone].size)).toEqual([327, 327, 326, 326]);
    expect(parsed.zoneTokens).toHaveLength(327);
    expect(
      ZONES.filter((zone: Zone) => parsed.zones[zone].has('--cds-notification-action-hover'))
    ).toEqual(['white', 'g10']);
    expect(Object.keys(parsed.aliases)).toHaveLength(15);
    expect(parsed.aliases['--cds-border-subtle']).toBe('--cds-border-subtle-00');
    expect(
      Object.entries(parsed.aliases).filter(([, source]) => !(source as string).endsWith('-01'))
    ).toEqual([['--cds-border-subtle', '--cds-border-subtle-00']]);
  });

  it('reads 19 type sizes and the two code families through var()', () => {
    const { typeTokens } = parseStylesheet(readCarbonStylesheet());

    expect(typeTokens.filter((name: string) => name.endsWith('-font-size'))).toHaveLength(19);
    expect(typeTokens.filter((name: string) => name.endsWith('-font-family'))).toEqual([
      '--cds-code-01-font-family',
      '--cds-code-02-font-family',
    ]);
  });

  it('matches the committed tokens.json byte for byte', () => {
    const tokens = buildTokens(parseStylesheet(readCarbonStylesheet()));

    expect(readFileSync(PATHS.tokens, 'utf8')).toBe(serialize(tokens));
  });
});
