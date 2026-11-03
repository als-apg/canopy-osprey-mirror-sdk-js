// scripts/spec-lib.mjs, the offline half of `spec:sync` / `spec:check`. The
// network half (fetching the tag) runs in CI as `spec:check`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SpecError,
  applySpec,
  assertReleaseTag,
  gitFiles,
  walkFiles,
  widgetIdent,
  widgetsModuleSource,
} from '../scripts/spec-lib.mjs';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'spec-lib-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('assertReleaseTag', () => {
  it('accepts vMAJOR.MINOR.PATCH', () => {
    expect(() => assertReleaseTag('v0.1.0')).not.toThrow();
    expect(() => assertReleaseTag('v12.3.45')).not.toThrow();
  });

  it.each(['main', 'v1', '0.1.0', 'v0.1.0-rc.1', '--upload-pack=x', '1b929457dfb06ca2'])(
    'rejects %s',
    (ref) => {
      expect(() => assertReleaseTag(ref)).toThrow(SpecError);
    }
  );
});

describe('widgetsModuleSource', () => {
  // Every id here matches canopy-spec's pattern, ^[a-z][a-z0-9-]*$.
  const ids = ['a--b', 'arc', 'default', 'led-', 'pv-1a', 'pv-label', 'pv1a', 'switch'];

  it('is valid TypeScript for any id the spec allows', () => {
    const { diagnostics } = ts.transpileModule(widgetsModuleSource(ids), {
      fileName: 'widgets.generated.ts',
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    expect(diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
      []
    );
  });

  it('gives every id its own import binding', () => {
    const bindings = ids.map(widgetIdent);
    expect(new Set(bindings).size).toBe(ids.length);
    for (const binding of bindings) expect(binding).toMatch(/^w_[a-z0-9_]+$/);
  });
});

/** A canopy-spec checkout with SPEC_PATHS, minus `omit`, and the given widget files. */
function makeCheckout(
  widgets: Record<string, unknown> = { 'pv-label': { id: 'pv-label' } },
  omit?: string
): string {
  const dir = join(tmp, 'checkout');
  const files: Record<string, string> = {
    'LICENSE.md': 'license\n',
    'screen-ir/screen-ir.schema.json': '{}\n',
    'screen-ir/widget-definition.schema.json': JSON.stringify({
      properties: { id: { pattern: '^[a-z][a-z0-9-]*$' } },
    }),
    'conformance/case.schema.json': '{}\n',
  };
  for (const [name, definition] of Object.entries(widgets)) {
    files[`screen-ir/widgets/${name}.json`] = JSON.stringify(definition);
  }
  for (const [path, content] of Object.entries(files)) {
    if (omit === undefined || !path.startsWith(omit)) write(join(dir, path), content);
  }
  return dir;
}

/** A package directory with an earlier spec/, lock and generated module. */
function makePackage(): string {
  const dir = join(tmp, 'pkg');
  write(join(dir, 'spec', 'old.txt'), 'old spec\n');
  write(join(dir, 'spec.lock.json'), 'old lock\n');
  write(join(dir, 'src', 'widgets.generated.ts'), 'old module\n');
  return dir;
}

function snapshot(pkgDir: string) {
  return {
    entries: readdirSync(pkgDir).sort(),
    spec: walkFiles(join(pkgDir, 'spec')),
    lock: readFileSync(join(pkgDir, 'spec.lock.json'), 'utf8'),
    generated: readFileSync(join(pkgDir, 'src', 'widgets.generated.ts'), 'utf8'),
  };
}

describe('applySpec', () => {
  const options = (checkoutDir: string, pkgDir: string) => ({
    checkoutDir,
    pkgDir,
    commit: 'c'.repeat(40),
    tag: 'v9.9.9',
  });

  it('replaces spec/ and writes the lock and the generated module', () => {
    const checkout = makeCheckout({ 'pv-label': { id: 'pv-label' }, arc: { id: 'arc' } });
    const pkg = makePackage();

    const files = applySpec(options(checkout, pkg));

    const spec = walkFiles(join(pkg, 'spec'));
    expect(spec).toEqual(walkFiles(checkout));
    expect(Object.keys(files)).toEqual(spec);
    const lock = JSON.parse(readFileSync(join(pkg, 'spec.lock.json'), 'utf8'));
    expect(lock).toEqual({
      repo: 'slaclab/canopy-spec',
      ref: 'v9.9.9',
      commit: 'c'.repeat(40),
      files,
    });
    expect(readFileSync(join(pkg, 'src', 'widgets.generated.ts'), 'utf8')).toBe(
      widgetsModuleSource(['arc', 'pv-label'])
    );
    expect(readdirSync(pkg).sort()).toEqual(['spec', 'spec.lock.json', 'src']);
  });

  it('changes nothing when the tag lacks a copied path', () => {
    const checkout = makeCheckout(undefined, 'conformance/');
    const pkg = makePackage();
    const before = snapshot(pkg);

    expect(() => applySpec(options(checkout, pkg))).toThrow(/has no conformance/);
    expect(snapshot(pkg)).toEqual(before);
  });

  it.each([
    ['an id that breaks the pattern', { Bad: { id: 'Bad' } }, /doesn't match/],
    ["a file whose id isn't its name", { 'pv-label': { id: 'pv-led' } }, /has id "pv-led"/],
  ])('changes nothing for %s', (_case, widgets, message) => {
    const checkout = makeCheckout(widgets);
    const pkg = makePackage();
    const before = snapshot(pkg);

    expect(() => applySpec(options(checkout, pkg))).toThrow(message);
    expect(snapshot(pkg)).toEqual(before);
  });
});

describe('gitFiles', () => {
  it('lists what git would commit, sorted by whole path', () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', tmp, ...args]);
    git('init', '-q');
    write(join(tmp, '.gitignore'), '.DS_Store\n');
    for (const path of ['spec/a.json', 'spec/widgets/b.json', 'spec/deleted.json']) {
      write(join(tmp, path), '{}');
    }
    git('add', 'spec');
    rmSync(join(tmp, 'spec/deleted.json'));
    write(join(tmp, 'spec/widgets-v2.json'), '{}'); // new, not yet added
    write(join(tmp, 'spec/.DS_Store'), 'junk'); // ignored
    write(join(tmp, 'other/c.json'), '{}'); // outside the paths asked for

    expect(gitFiles(tmp, ['spec'])).toEqual([
      'spec/a.json',
      'spec/widgets-v2.json',
      'spec/widgets/b.json',
    ]);
  });
});

describe('walkFiles', () => {
  it('lists every file, sorted by whole path', () => {
    for (const path of ['widgets/b.json', 'widgets-v2.json', 'a.json']) write(join(tmp, path), '');
    expect(walkFiles(tmp)).toEqual(['a.json', 'widgets-v2.json', 'widgets/b.json']);
  });
});
