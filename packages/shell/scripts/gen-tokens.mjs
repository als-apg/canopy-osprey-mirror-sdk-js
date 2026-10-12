// gen-tokens: derive the host theme contract from the compiled Carbon stylesheet.
//
// The stylesheet that ships in the lockfile-pinned `@carbon/styles` is the source of truth. This
// script parses its four zone blocks (`.cds--white|g10|g90|g100`), enumerates what they declare,
// and writes `tokens.json`: the 27 contract names, the Carbon token each one aliases standalone,
// and the literal that token has in each zone (the per-zone fallback of the hosted block).
//
// `wiring.json` is the hand-reviewed map from every enumerated Carbon token to the contract
// expression that drives it when hosted, or to the reason it keeps Carbon's value. `--check`
// writes nothing: it fails, naming the token, when that map and the stylesheet disagree.
//
// Run it through the package script only (`pnpm run gen-tokens`). Inputs and outputs are resolved
// from this file's own location, never from the working directory.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package directory is `new URL('../', import.meta.url)`. It is spelled through the file path
// because Vite rewrites that literal expression into an asset URL when a test imports this module.
const SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_DIR = dirname(dirname(SCRIPT));

/** Every file the generator reads or writes, relative to the package this script lives in. */
export const PATHS = {
  tokens: join(PACKAGE_DIR, 'tokens.json'),
  wiring: join(PACKAGE_DIR, 'wiring.json'),
  sheet: join(PACKAGE_DIR, 'host-contract.css'),
};

export const CONTRACT_VERSION = 1;
export const ZONES = ['white', 'g10', 'g90', 'g100'];

/** A zone block with fewer declarations than this is not the theme block we are looking for. */
export const MIN_ZONE_DECLARATIONS = 200;

const DECLARATION = /(--cds-[a-z0-9-]+):\s*([^;]+);/g;
const CONTEXT_ALIAS = /^var\((--cds-[a-z0-9-]+-0[0-3]),\s*((?:[^()]|\([^()]*\))+)\)$/;
const TYPE_READ = /var\(\s*(--cds-[a-z0-9-]+-font-(?:size|family))\b/g;
const LAYOUT_CONSTANTS = ['--cds-layout-size-height-xs', '--cds-layout-size-height-sm'];

/** Tokens whose absence means Carbon renamed a family the wiring depends on. */
export const SENTINELS = [
  '--cds-button-primary-hover',
  '--cds-toggle-off',
  '--cds-content-switcher-selected',
  '--cds-button-danger-primary',
  '--cds-button-separator',
];

/**
 * `--cds-border-subtle` must keep deriving from `-00`: the contract's `border` aliases
 * `border-subtle-00`, so a Carbon that moves the alias to `-01` would silently change which
 * contract name paints layer-one borders.
 */
export const VALUE_SENTINEL = {
  token: '--cds-border-subtle',
  pattern: /^var\(--cds-border-subtle-00,/,
};

/**
 * The contract, in its published order. A colour name aliases one Carbon zone token and falls
 * back to that token's literal in each zone. A non-colour name has a fixed literal equal to
 * Carbon's own `:root` constant, so a standalone page keeps its pixels.
 */
export const CONTRACT = [
  ['font-ui', { literal: "'IBM Plex Sans', system-ui, sans-serif" }],
  ['font-mono', { literal: "'IBM Plex Mono', monospace" }],
  ['text-sm', { literal: '0.75rem' }],
  ['text-md', { literal: '0.875rem' }],
  ['text-lg', { literal: '1rem' }],
  ['radius-sm', { literal: '0' }],
  ['radius-md', { literal: '0' }],
  ['control-h-xs', { literal: '1.5rem', layout: '--cds-layout-size-height-xs' }],
  ['control-h-sm', { literal: '2rem', layout: '--cds-layout-size-height-sm' }],
  ['bg-base', { alias: 'background' }],
  ['bg-panel', { alias: 'layer-01' }],
  ['bg-elevated', { alias: 'layer-02' }],
  ['bg-field', { alias: 'field-01' }],
  ['text-primary', { alias: 'text-primary' }],
  ['text-secondary', { alias: 'text-secondary' }],
  ['text-muted', { alias: 'text-helper' }],
  ['border', { alias: 'border-subtle-00' }],
  ['border-strong', { alias: 'border-strong-01' }],
  ['accent', { alias: 'interactive' }],
  ['on-accent', { alias: 'text-on-color' }],
  ['accent-hover', { alias: 'button-primary-hover' }],
  ['accent-tint', { alias: 'layer-selected-01' }],
  ['hover-tint', { alias: 'layer-hover-01' }],
  ['focus', { alias: 'focus' }],
  ['status-success', { alias: 'support-success' }],
  ['status-warning', { alias: 'support-warning' }],
  ['status-error', { alias: 'support-error' }],
];

/** The groups of `wiring.json`, one per family of enumerated token. */
export const WIRING_GROUPS = ['zone', 'type', 'layout'];

/** Why a context alias is never wired: it follows the `-0x` token it derives from. */
export const ALIAS_REASON = 'context alias derives from the -0x token';

const CONTRACT_REFERENCE = /--canopy-([a-z0-9-]+)/g;

function fail(message) {
  throw new Error(`gen-tokens: ${message}`);
}

/** The declarations of the one `.cds--<zone> { … }` theme block, as a name → value map. */
function parseZoneBlock(css, zone) {
  const block = new RegExp(`(?:^|\\})\\s*\\.cds--${zone}\\s*\\{([^{}]*)\\}`, 'gm');
  const found = [];
  for (const match of css.matchAll(block)) {
    const declarations = new Map();
    for (const [, name, value] of match[1].matchAll(DECLARATION)) {
      declarations.set(name, value.trim());
    }
    if (declarations.size >= MIN_ZONE_DECLARATIONS) found.push(declarations);
  }
  if (found.length !== 1) {
    fail(
      `expected one .cds--${zone} block with at least ${MIN_ZONE_DECLARATIONS} declarations, found ${found.length}`
    );
  }
  return found[0];
}

/** The two layout constants, which Carbon declares on `:root`. */
function parseLayoutConstants(css) {
  const layout = {};
  for (const [, body] of css.matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/gm)) {
    for (const [, name, value] of body.matchAll(DECLARATION)) {
      if (LAYOUT_CONSTANTS.includes(name)) layout[name] = value.trim();
    }
  }
  for (const name of LAYOUT_CONSTANTS) {
    if (!(name in layout)) fail(`layout constant ${name} is not declared on :root`);
  }
  return layout;
}

/**
 * Parse a compiled Carbon stylesheet.
 *
 * Returns the per-zone declarations (`zones`), the enumerated zone token set as the sorted union
 * over the four blocks (`zoneTokens`; a token may be absent from some zones), the context aliases
 * (`aliases`: token → the `-0x` token it derives from), the type tokens the stylesheet reads
 * through `var()` (`typeTokens`) and the two `:root` layout constants (`layout`).
 */
export function parseStylesheet(css) {
  const zones = {};
  const union = new Set();
  const aliases = {};
  for (const zone of ZONES) {
    const declarations = parseZoneBlock(css, zone);
    zones[zone] = declarations;
    for (const [name, value] of declarations) {
      union.add(name);
      if (!value.includes('var(')) continue;
      const alias = CONTEXT_ALIAS.exec(value);
      if (!alias || alias[2].includes('var(')) {
        fail(`${name} in .cds--${zone} has an unsupported var() value: ${value}`);
      }
      if (aliases[name] !== undefined && aliases[name] !== alias[1]) {
        fail(`${name} derives from ${aliases[name]} in one zone and ${alias[1]} in .cds--${zone}`);
      }
      aliases[name] = alias[1];
    }
  }

  for (const zone of ZONES) {
    for (const sentinel of SENTINELS) {
      if (!zones[zone].has(sentinel)) fail(`sentinel ${sentinel} is missing from .cds--${zone}`);
    }
    const value = zones[zone].get(VALUE_SENTINEL.token);
    if (value === undefined || !VALUE_SENTINEL.pattern.test(value)) {
      fail(
        `${VALUE_SENTINEL.token} in .cds--${zone} no longer derives from --cds-border-subtle-00: ${value}`
      );
    }
  }

  const typeTokens = [...new Set([...css.matchAll(TYPE_READ)].map((match) => match[1]))].sort();
  if (typeTokens.length === 0) fail('the stylesheet reads no type token through var()');

  return {
    zones,
    zoneTokens: [...union].sort(),
    aliases,
    typeTokens,
    layout: parseLayoutConstants(css),
  };
}

/** The `tokens.json` document for a parsed stylesheet. */
export function buildTokens(parsed) {
  const names = {};
  for (const [name, spec] of CONTRACT) {
    const literals = {};
    if (spec.alias === undefined) {
      if (spec.layout !== undefined && parsed.layout[spec.layout] !== spec.literal) {
        fail(
          `${name} is fixed at ${spec.literal} but ${spec.layout} is ${parsed.layout[spec.layout]}`
        );
      }
      for (const zone of ZONES) literals[zone] = spec.literal;
      names[name] = { alias: null, literals };
      continue;
    }
    const source = `--cds-${spec.alias}`;
    for (const zone of ZONES) {
      const value = parsed.zones[zone].get(source);
      if (value === undefined) {
        fail(`${name} aliases ${source}, which .cds--${zone} does not declare`);
      }
      if (value.includes('var(')) {
        fail(`${name} aliases ${source}, which is itself an alias in .cds--${zone}: ${value}`);
      }
      literals[zone] = value;
    }
    names[name] = { alias: spec.alias, literals };
  }
  return { contract: CONTRACT_VERSION, zones: ZONES, names };
}

/** The tokens `wiring.json` must map, group by group: exactly these and no others. */
export function enumerateTokens(parsed) {
  return {
    zone: parsed.zoneTokens,
    type: parsed.typeTokens,
    layout: Object.keys(parsed.layout).sort(),
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One wiring entry is a contract expression or `{ "carbon": "<reason>" }`. */
function checkWiringEntry(group, token, entry, aliases) {
  const where = `wiring.json group "${group}" maps ${token}`;
  if (isRecord(entry)) {
    const keys = Object.keys(entry);
    if (keys.length !== 1 || keys[0] !== 'carbon') {
      fail(`${where} to an object that is not { "carbon": "<reason>" }`);
    }
    if (typeof entry.carbon !== 'string' || entry.carbon.trim() === '') {
      fail(`${where} to Carbon without a reason`);
    }
    return;
  }
  if (typeof entry !== 'string' || entry.trim() === '') {
    fail(`${where} to neither a contract expression nor { "carbon": "<reason>" }`);
  }
  if (token in aliases) {
    fail(`${where} to an expression, but it is a context alias of ${aliases[token]}`);
  }
  // A hosted `--cds-*` that reads another `--cds-*` can close a cycle with the contract aliases.
  if (entry.includes('--cds-')) fail(`${where} to an expression that reads a Carbon token`);
  const names = new Set(CONTRACT.map(([name]) => name));
  const references = [...entry.matchAll(CONTRACT_REFERENCE)].map((match) => match[1]);
  if (references.length === 0) fail(`${where} to an expression that reads no contract name`);
  for (const name of references) {
    if (!names.has(name)) fail(`${where} to --canopy-${name}, which is not a contract name`);
  }
}

/**
 * Check a `wiring.json` document against a parsed stylesheet, in both directions and group by
 * group: every enumerated token is mapped, and no mapped key is outside the enumeration. The
 * first disagreement throws, naming the group and the token.
 */
export function checkWiring(wiring, parsed) {
  if (!isRecord(wiring)) fail('wiring.json is not an object of groups');
  for (const group of Object.keys(wiring)) {
    if (!WIRING_GROUPS.includes(group)) fail(`wiring.json has an unknown group "${group}"`);
  }
  const enumerated = enumerateTokens(parsed);
  for (const group of WIRING_GROUPS) {
    const map = wiring[group];
    if (!isRecord(map)) fail(`wiring.json has no group "${group}"`);
    for (const token of enumerated[group]) {
      if (!Object.hasOwn(map, token)) {
        fail(`wiring.json group "${group}" does not map ${token}`);
      }
    }
    const known = new Set(enumerated[group]);
    for (const token of Object.keys(map)) {
      if (!known.has(token)) {
        fail(`wiring.json group "${group}" maps ${token}, which the stylesheet does not enumerate`);
      }
      checkWiringEntry(group, token, map[token], parsed.aliases);
    }
  }
}

/** The exact bytes of a generated JSON file. */
export function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The compiled stylesheet of the `@carbon/styles` this package resolves. */
export function readCarbonStylesheet() {
  const manifest = createRequire(import.meta.url).resolve('@carbon/styles/package.json');
  return readFileSync(join(dirname(manifest), 'css', 'styles.css'), 'utf8');
}

/** The committed wiring map of this package. */
function readWiring() {
  let text;
  try {
    text = readFileSync(PATHS.wiring, 'utf8');
  } catch {
    fail(`cannot read ${PATHS.wiring}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${PATHS.wiring} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function main(args) {
  const unknown = args.find((arg) => arg !== '--check');
  if (unknown !== undefined) fail(`unknown argument ${unknown}`);
  const parsed = parseStylesheet(readCarbonStylesheet());
  if (args.includes('--check')) {
    buildTokens(parsed);
    checkWiring(readWiring(), parsed);
    console.log(`gen-tokens: ${PATHS.wiring} maps every enumerated token`);
    return;
  }
  const tokens = buildTokens(parsed);
  writeFileSync(PATHS.tokens, serialize(tokens));
  console.log(`gen-tokens: wrote ${PATHS.tokens}`);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === SCRIPT) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
