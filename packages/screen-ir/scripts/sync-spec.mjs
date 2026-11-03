#!/usr/bin/env node
// Copy the Screen IR contract from slaclab/canopy-spec into ./spec, pinned to a
// release tag, or check that ./spec still matches that tag.
//
//   pnpm --filter @slaclab/canopy-screen-ir run spec:sync <tag>   # e.g. v0.1.0
//   pnpm --filter @slaclab/canopy-screen-ir run spec:check        # what CI runs
//
// sync fetches canopy-spec at <tag> with git, replaces spec/ with its
// LICENSE.md, screen-ir/ and conformance/, writes spec.lock.json (tag, commit,
// sha256 per file), and regenerates src/widgets.generated.ts.
//
// check fetches the tag in spec.lock.json and fails unless the tag still points
// at the locked commit and every file under spec/ is byte-identical to it.
//
// Never edit files under spec/ by hand. Change canopy-spec, tag a release, then
// sync to the new tag.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'slaclab/canopy-spec';
/** canopy-spec paths copied into ./spec. The license asks for LICENSE.md next to the copies. */
const SPEC_PATHS = ['LICENSE.md', 'screen-ir', 'conformance'];

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const specDir = join(pkgDir, 'spec');
const lockPath = join(pkgDir, 'spec.lock.json');
const generatedPath = join(pkgDir, 'src', 'widgets.generated.ts');

const [command, ref, ...rest] = process.argv.slice(2);
if (command === 'sync' && ref && !ref.startsWith('-') && rest.length === 0) {
  sync(ref);
} else if (command === 'check' && ref === undefined) {
  check();
} else {
  console.error('usage: sync-spec.mjs sync <tag>   (a canopy-spec release tag, e.g. v0.1.0)');
  console.error('       sync-spec.mjs check');
  process.exit(2);
}

function sync(tag) {
  withCheckout(tag, (dir, commit) => {
    rmSync(specDir, { recursive: true, force: true });
    for (const path of SPEC_PATHS) {
      cpSync(join(dir, path), join(specDir, path), { recursive: true });
    }
    const files = hashFiles(specDir);
    const lock = { repo: REPO, ref: tag, commit, files };
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    writeFileSync(generatedPath, generateWidgetsModule());
    console.log(
      `synced ${REPO}@${tag} (${commit.slice(0, 7)}): ${Object.keys(files).length} files`
    );
  });
}

function check() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  withCheckout(lock.ref, (dir, commit) => {
    const problems = [];
    if (commit !== lock.commit) {
      problems.push(`${lock.ref} now points at ${commit}; spec.lock.json pins ${lock.commit}`);
    }
    const upstream = hashFiles(dir, SPEC_PATHS);
    const local = existsSync(specDir) ? hashFiles(specDir) : {};
    const paths = [...new Set([...Object.keys(upstream), ...Object.keys(local)])].sort();
    for (const path of paths) {
      if (!(path in local)) problems.push(`spec/${path} is missing`);
      else if (!(path in upstream)) problems.push(`spec/${path} is not in ${REPO}@${lock.ref}`);
      else if (local[path] !== upstream[path]) {
        problems.push(`spec/${path} differs from ${REPO}@${lock.ref}`);
      }
      if (!(path in upstream)) continue;
      if (!(path in lock.files)) problems.push(`spec.lock.json doesn't list ${path}`);
      else if (lock.files[path] !== upstream[path]) {
        problems.push(`spec.lock.json has the wrong sha256 for ${path}`);
      }
    }
    for (const path of Object.keys(lock.files)) {
      if (!(path in upstream)) problems.push(`spec.lock.json lists ${path}, which isn't upstream`);
    }
    if (problems.length > 0) {
      console.error(problems.join('\n'));
      console.error(`Don't edit spec/ by hand; re-run spec:sync with a canopy-spec tag.`);
      process.exit(1);
    }
    console.log(`spec/ is byte-identical to ${REPO}@${lock.ref} (${commit.slice(0, 7)})`);
  });
}

/** Fetches `ref` of canopy-spec into a temporary directory and calls `fn(dir, commit)`. */
function withCheckout(ref, fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'canopy-spec-'));
  // autocrlf off: the copies must have the bytes git stores, on every OS.
  const git = (...args) =>
    execFileSync('git', ['-C', tmp, '-c', 'core.autocrlf=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  try {
    git('init', '-q');
    git('fetch', '-q', '--depth=1', `https://github.com/${REPO}.git`, ref);
    const commit = git('rev-parse', 'FETCH_HEAD^{commit}');
    git('checkout', '-q', '--detach', commit);
    fn(tmp, commit);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** sha256 of every file under `root` (or under `paths` within it), keyed by `/`-separated path. */
function hashFiles(root, paths = ['']) {
  const files = {};
  for (const file of paths.flatMap((path) => listFiles(join(root, path))).sort()) {
    files[relative(root, file).split(sep).join('/')] = createHash('sha256')
      .update(readFileSync(file))
      .digest('hex');
  }
  return files;
}

function listFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => listFiles(join(path, name)));
}

function generateWidgetsModule() {
  const ids = readdirSync(join(specDir, 'screen-ir', 'widgets'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
  const ident = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const entry = (id) => (ident(id) === id ? `  ${id},` : `  '${id}': ${ident(id)},`);
  return [
    '// Generated by scripts/sync-spec.mjs from spec/screen-ir/widgets. Do not edit;',
    '// re-run the sync instead. src/spec.test.ts checks this against the files.',
    '',
    ...ids.map(
      (id) =>
        `import ${ident(id)} from '../spec/screen-ir/widgets/${id}.json' with { type: 'json' };`
    ),
    '',
    'export const IR_WIDGET_TYPES = [',
    ...ids.map((id) => `  '${id}',`),
    '] as const;',
    '',
    'export const WIDGET_DEFINITION_DATA = {',
    ...ids.map(entry),
    '};',
    '',
  ].join('\n');
}
