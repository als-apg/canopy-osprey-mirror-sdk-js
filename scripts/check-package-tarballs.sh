#!/usr/bin/env bash
# Checks what every package would publish. Run it after `pnpm build` and before
# tagging: a version can't be reused on npm, so a bad tarball can't be replaced.
#
# Packs with pnpm because that's what publishes. pnpm copies the root LICENSE.md
# into each tarball and turns workspace: ranges into real ones; `npm pack` and
# `npm publish` in a package directory do neither.
set -euo pipefail

cd "$(dirname "$0")/.."

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

pnpm --filter './packages/*' pack --pack-destination "$out" > /dev/null

packages=(packages/*/package.json)
tarballs=("$out"/*.tgz)
status=0

if [ "${#tarballs[@]}" -ne "${#packages[@]}" ]; then
  echo "::error::packed ${#tarballs[@]} tarballs for ${#packages[@]} packages"
  status=1
fi

for tarball in "${tarballs[@]}"; do
  name=$(basename "$tarball")
  files=$(tar tzf "$tarball")
  manifest=$(tar xzOf "$tarball" package/package.json)

  if ! grep -qx 'package/LICENSE.md' <<< "$files"; then
    echo "::error::$name has no LICENSE.md"
    status=1
  fi
  if ! grep -q '^package/dist/' <<< "$files"; then
    echo "::error::$name has no dist/ (run pnpm build first)"
    status=1
  fi
  if ! grep -q '"license":' <<< "$manifest"; then
    echo "::error::$name has no license field"
    status=1
  fi
  if grep -q '"workspace:' <<< "$manifest"; then
    echo "::error::$name still has a workspace: dependency"
    status=1
  fi
done

[ "$status" = 0 ] && echo "${#tarballs[@]} tarballs OK"
exit "$status"
