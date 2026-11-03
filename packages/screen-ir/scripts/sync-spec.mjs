#!/usr/bin/env node
// Copy the Screen IR contract from slaclab/canopy-spec into ./spec, pinned to a
// release tag, or check that ./spec still matches that tag.
//
//   pnpm --filter @slaclab/canopy-screen-ir run spec:sync <tag>   # e.g. v0.1.0
//   pnpm --filter @slaclab/canopy-screen-ir run spec:check        # what CI runs
//
// sync fetches canopy-spec at release tag <tag> with git, replaces spec/ with
// its LICENSE.md, screen-ir/ and conformance/, writes spec.lock.json (tag,
// commit, sha256 per file), and regenerates src/widgets.generated.ts. It
// changes nothing unless every step succeeds.
//
// check fetches the tag in spec.lock.json and fails unless the tag still points
// at the locked commit and every file under spec/ is byte-identical to it.
// Files git ignores (.DS_Store, ...) don't count.
//
// Never edit files under spec/ by hand. Change canopy-spec, tag a release, then
// sync to the new tag.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO,
  SPEC_PATHS,
  SpecError,
  applySpec,
  assertReleaseTag,
  gitFiles,
  hashFiles,
  withCheckout,
} from './spec-lib.mjs';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const [command, ref, ...rest] = process.argv.slice(2);
try {
  if (command === 'sync' && ref && rest.length === 0) {
    sync(ref);
  } else if (command === 'check' && ref === undefined) {
    check();
  } else {
    console.error('usage: sync-spec.mjs sync <tag>   (a canopy-spec release tag, e.g. v0.1.0)');
    console.error('       sync-spec.mjs check');
    process.exit(2);
  }
} catch (error) {
  if (!(error instanceof SpecError)) throw error;
  console.error(error.message);
  process.exit(1);
}

function sync(tag) {
  assertReleaseTag(tag);
  withCheckout(tag, (checkoutDir, commit) => {
    const files = applySpec({ checkoutDir, commit, tag, pkgDir });
    console.log(
      `synced ${REPO}@${tag} (${commit.slice(0, 7)}): ${Object.keys(files).length} files`
    );
  });
}

function check() {
  const lock = JSON.parse(readFileSync(join(pkgDir, 'spec.lock.json'), 'utf8'));
  withCheckout(lock.ref, (dir, commit) => {
    const problems = [];
    if (commit !== lock.commit) {
      problems.push(`${lock.ref} now points at ${commit}; spec.lock.json pins ${lock.commit}`);
    }
    const upstream = hashFiles(dir, gitFiles(dir, SPEC_PATHS));
    const specFiles = gitFiles(pkgDir, ['spec']).map((path) => path.slice('spec/'.length));
    const local = hashFiles(join(pkgDir, 'spec'), specFiles);
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
      throw new SpecError(
        `${problems.join('\n')}\nDon't edit spec/ by hand; re-run spec:sync with a canopy-spec tag.`
      );
    }
    console.log(`spec/ is byte-identical to ${REPO}@${lock.ref} (${commit.slice(0, 7)})`);
  });
}
