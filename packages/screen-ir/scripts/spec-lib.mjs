// The parts of the canopy-spec sync that don't need the network, so
// src/sync-spec.test.ts can test them. sync-spec.mjs is the command line.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO = 'slaclab/canopy-spec';
/** canopy-spec paths copied into ./spec. The license asks for LICENSE.md next to the copies. */
export const SPEC_PATHS = ['LICENSE.md', 'screen-ir', 'conformance'];
/** A canopy-spec release tag. src/spec.test.ts requires the same form in spec.lock.json. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** A problem worth a one-line message rather than a stack trace. */
export class SpecError extends Error {}

export function assertReleaseTag(tag) {
  if (!RELEASE_TAG.test(tag)) {
    throw new SpecError(`${JSON.stringify(tag)} is not a canopy-spec release tag such as v0.1.0`);
  }
}

/** Fetches release tag `tag` of canopy-spec into a temporary directory and calls `fn(dir, commit)`. */
export function withCheckout(tag, fn) {
  assertReleaseTag(tag);
  const tmp = mkdtempSync(join(tmpdir(), 'canopy-spec-'));
  // autocrlf off: the copies must have the bytes git stores, on every OS.
  const git = (...args) =>
    execFileSync('git', ['-C', tmp, '-c', 'core.autocrlf=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  try {
    git('init', '-q');
    try {
      // The full ref, so a branch or commit of the same name can't stand in for the tag.
      git('fetch', '-q', '--depth=1', `https://github.com/${REPO}.git`, `refs/tags/${tag}`);
    } catch {
      // git has already printed why (no such tag, no network, ...).
      throw new SpecError(`couldn't fetch ${REPO}@${tag}`);
    }
    const commit = git('rev-parse', 'FETCH_HEAD^{commit}');
    git('checkout', '-q', '--detach', commit);
    return fn(tmp, commit);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The files git would commit under `paths` of the work tree at `dir`: tracked
 * or new, never ignored (so a stray .DS_Store doesn't count), and only those
 * that exist (a tracked file deleted from disk is missing, not listed).
 * `/`-separated, relative to `dir`, sorted.
 */
export function gitFiles(dir, paths) {
  const out = execFileSync(
    'git',
    ['-C', dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...paths],
    { encoding: 'utf8' }
  );
  const files = new Set(out.split('\0').filter((path) => path !== ''));
  return [...files].filter((path) => existsSync(join(dir, path))).sort();
}

/** Every file under `root`, `/`-separated and relative to it, sorted. */
export function walkFiles(root, prefix = '') {
  return readdirSync(join(root, prefix))
    .flatMap((name) => {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      return statSync(join(root, path)).isDirectory() ? walkFiles(root, path) : [path];
    })
    .sort();
}

/** sha256 of each of `files` (paths relative to `root`), keyed by path, in sorted order. */
export function hashFiles(root, files) {
  const hashes = {};
  for (const path of [...files].sort()) {
    hashes[path] = createHash('sha256')
      .update(readFileSync(join(root, path)))
      .digest('hex');
  }
  return hashes;
}

/**
 * The widget type ids in `<specRoot>/screen-ir/widgets`, sorted. Throws unless
 * each matches the copied widget-definition.schema.json's id pattern and its
 * file's `id` equals the filename.
 */
export function readWidgetIds(specRoot) {
  const irDir = join(specRoot, 'screen-ir');
  const definitionSchema = JSON.parse(
    readFileSync(join(irDir, 'widget-definition.schema.json'), 'utf8')
  );
  const idPattern = new RegExp(definitionSchema.properties.id.pattern);
  const ids = readdirSync(join(irDir, 'widgets'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
  const problems = [];
  for (const id of ids) {
    const file = JSON.parse(readFileSync(join(irDir, 'widgets', `${id}.json`), 'utf8'));
    if (!idPattern.test(id))
      problems.push(`widget id ${JSON.stringify(id)} doesn't match ${idPattern}`);
    if (file.id !== id) problems.push(`widgets/${id}.json has id ${JSON.stringify(file.id)}`);
  }
  if (problems.length > 0) throw new SpecError(problems.join('\n'));
  return ids;
}

/**
 * The import binding for widget `id`. Ids are kebab-case (`[a-z][a-z0-9-]*`),
 * so mapping `-` to `_` can't make two ids collide, and the `w_` prefix keeps
 * an id such as `switch` from becoming a reserved word.
 */
export function widgetIdent(id) {
  return `w_${id.replaceAll('-', '_')}`;
}

/** Source of src/widgets.generated.ts for the widget `ids`. */
export function widgetsModuleSource(ids) {
  const key = (id) => (/^[a-z][a-z0-9]*$/.test(id) ? id : `'${id}'`);
  return [
    '// Generated by scripts/sync-spec.mjs from spec/screen-ir/widgets. Do not edit;',
    '// re-run the sync instead. src/spec.test.ts checks this against the files.',
    '',
    ...ids.map(
      (id) =>
        `import ${widgetIdent(id)} from '../spec/screen-ir/widgets/${id}.json' with { type: 'json' };`
    ),
    '',
    'export const IR_WIDGET_TYPES = [',
    ...ids.map((id) => `  '${id}',`),
    '] as const;',
    '',
    'export const WIDGET_DEFINITION_DATA = {',
    ...ids.map((id) => `  ${key(id)}: ${widgetIdent(id)},`),
    '};',
    '',
  ].join('\n');
}

/**
 * Replaces `<pkgDir>/spec` with SPEC_PATHS from a canopy-spec checkout, and
 * writes spec.lock.json and src/widgets.generated.ts. Everything is copied and
 * checked in a staging directory first, so a failure leaves spec/ untouched.
 * Returns the sha256 of each copied file.
 */
export function applySpec({ checkoutDir, commit, tag, pkgDir }) {
  const absent = SPEC_PATHS.filter((path) => !existsSync(join(checkoutDir, path)));
  if (absent.length > 0) throw new SpecError(`${REPO}@${tag} has no ${absent.join(', ')}`);

  // Inside the package, so the final rename stays on one file system.
  const staging = mkdtempSync(join(pkgDir, '.spec-staging-'));
  try {
    for (const path of SPEC_PATHS) {
      cpSync(join(checkoutDir, path), join(staging, path), { recursive: true });
    }
    const files = hashFiles(staging, walkFiles(staging));
    const generated = widgetsModuleSource(readWidgetIds(staging));

    const specDir = join(pkgDir, 'spec');
    rmSync(specDir, { recursive: true, force: true });
    renameSync(staging, specDir);
    const lock = { repo: REPO, ref: tag, commit, files };
    writeFileSync(join(pkgDir, 'spec.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    writeFileSync(join(pkgDir, 'src', 'widgets.generated.ts'), generated);
    return files;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
