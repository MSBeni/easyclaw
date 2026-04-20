#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
compat_package_dir="packages/openclaw"

if [[ "${mode}" != "--dry-run" && "${mode}" != "--publish" ]]; then
  echo "usage: bash scripts/openclaw-npm-publish.sh [--dry-run|--publish]" >&2
  exit 2
fi

package_version="$(node -p "require('./${compat_package_dir}/package.json').version")"
publish_cmd=(npm publish "./${compat_package_dir}" --access public --provenance)
release_channel="stable"

if [[ "${package_version}" == *-beta.* ]]; then
  publish_cmd=(npm publish "./${compat_package_dir}" --access public --tag beta --provenance)
  release_channel="beta"
fi

echo "Resolved package version: ${package_version}"
echo "Resolved release channel: ${release_channel}"
echo "Publish auth: GitHub OIDC trusted publishing"

printf 'Publish command:'
printf ' %q' "${publish_cmd[@]}"
printf '\n'

if [[ "${mode}" == "--dry-run" ]]; then
  exit 0
fi

"${publish_cmd[@]}"
