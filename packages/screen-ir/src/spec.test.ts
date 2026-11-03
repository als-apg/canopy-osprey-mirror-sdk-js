// The copy of slaclab/canopy-spec under ../spec must match spec.lock.json, and
// widgets.generated.ts must match the copied widget files. CI also runs
// `spec:check`, which compares the copy with the tag itself.
//
// The generated module is compared by content (type list and definitions), not
// as text: Prettier may reformat it on commit, so a text comparison would be
// brittle.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MACRO_NAME_PATTERN } from './macros.js';
import { SCHEMA_VERSION } from './screen.js';
import { IR_WIDGET_TYPES, WIDGET_DEFINITIONS } from './widgets.js';
import schema from '../spec/screen-ir/screen-ir.schema.json' with { type: 'json' };

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const specDir = join(pkgDir, 'spec');

interface SpecLock {
  readonly repo: string;
  readonly ref: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
}
const lock = JSON.parse(readFileSync(join(pkgDir, 'spec.lock.json'), 'utf8')) as SpecLock;

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

const specFiles = listFiles(specDir).map((file) => relative(specDir, file).split(sep).join('/'));

describe('spec copy', () => {
  it('is pinned to a canopy-spec release tag and commit', () => {
    expect(lock.repo).toBe('slaclab/canopy-spec');
    expect(lock.ref).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('keeps the license next to the copies', () => {
    expect(specFiles).toContain('LICENSE.md');
  });

  it('has exactly the files listed in spec.lock.json', () => {
    expect(specFiles).toEqual(Object.keys(lock.files).sort());
  });

  it.each(Object.entries(lock.files))('%s is unedited', (path, hash) => {
    const actual = createHash('sha256')
      .update(readFileSync(join(specDir, path)))
      .digest('hex');
    expect(actual, `${path} differs from canopy-spec@${lock.ref}; re-run spec:sync`).toBe(hash);
  });
});

describe('generated widget module', () => {
  const widgetFiles = specFiles
    .filter((path) => path.startsWith('screen-ir/widgets/') && path.endsWith('.json'))
    .map((path) => path.slice('screen-ir/widgets/'.length, -'.json'.length))
    .sort();

  it('lists every widget definition file', () => {
    expect([...IR_WIDGET_TYPES]).toEqual(widgetFiles);
    expect(Object.keys(WIDGET_DEFINITIONS).sort()).toEqual(widgetFiles);
  });

  it.each(widgetFiles)('%s matches its file', (id) => {
    const file = JSON.parse(readFileSync(join(specDir, 'screen-ir/widgets', `${id}.json`), 'utf8'));
    expect(WIDGET_DEFINITIONS[id as keyof typeof WIDGET_DEFINITIONS]).toEqual(file);
  });
});

describe('constants read from the copied schema', () => {
  it('SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe(schema.properties.schemaVersion.const);
  });

  it('MACRO_NAME_PATTERN', () => {
    expect(MACRO_NAME_PATTERN.source).toBe(schema.$defs.MacroDeclaration.properties.name.pattern);
  });
});
