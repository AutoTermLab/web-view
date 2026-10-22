#!/usr/bin/env bash
# Upload a built data version to R2 with rclone (docs/implementation-plan.md §7).
#
#   prep/upload.sh --remote r2:BUCKET --version v1 [--src dist-data] [--dry-run] [--force]
#
# Files go to <remote>/autoterm/<version>/, each type with its own headers. The version is then
# checked against the local build, and only after that is autoterm/latest.json switched.
# Credentials come from your rclone remote; they are never read or stored by this script.
set -euo pipefail

src=dist-data dry=() force=0
while (( $# )); do
  case $1 in
    --remote) remote=$2; shift 2 ;;
    --version) version=$2; shift 2 ;;
    --src) src=$2; shift 2 ;;
    --dry-run) dry=(--dry-run); shift ;;
    --force) force=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
: "${remote:?--remote is required, e.g. r2:BUCKET}" "${version:?--version is required, e.g. v1}"

[[ -f $src/$version/manifest.json ]] || { echo "no build for $version in $src (missing manifest.json)" >&2; exit 1; }
dest=$remote/autoterm/$version

existing=$(rclone lsf "$dest" --max-depth 1 2>/dev/null || true)
if [[ -n $existing && $force == 0 ]]; then
  echo "$dest already exists; versions are written once (use --force to overwrite)" >&2
  exit 1
fi

common=(--s3-no-check-bucket --transfers 16 --checkers 16 --header-upload "Cache-Control: public, max-age=31536000, immutable" "${dry[@]}")
(( force )) || common+=(--immutable)

push() {  # pattern, content type, then any extra rclone flags
  local pattern=$1 type=$2; shift 2
  rclone copy "$src/$version" "$dest" --include "$pattern" --header-upload "Content-Type: $type" "$@" "${common[@]}"
}
push '*.geojson' application/geo+json --header-upload "Content-Encoding: gzip"
push '*.json' application/json --header-upload "Content-Encoding: gzip"
push '*.csv' 'text/csv; charset=utf-8'
push '*.gpkg' application/geopackage+sqlite3 --header-upload "Content-Disposition: attachment"

if (( ${#dry[@]} )); then
  echo "dry run: skipped the check and latest.json"
  exit 0
fi

rclone check "$src/$version" "$dest" --one-way --s3-no-check-bucket \
  || { echo "verification failed; latest.json was not switched" >&2; exit 1; }

latest=$(mktemp)
trap 'rm -f "$latest"' EXIT
printf '{"version":"%s"}\n' "$version" > "$latest"
rclone copyto "$latest" "$remote/autoterm/latest.json" --s3-no-check-bucket \
  --header-upload "Content-Type: application/json" --header-upload "Cache-Control: public, max-age=60"
echo "uploaded $version; latest.json now points to it"
