#!/usr/bin/env bash
# Unpack a Lighthouse project export into a working tree.
#
# Dependency directories and build output are skipped by default: they are the
# bulk of the archive, they are rebuildable from the lockfiles, and they must
# not land in git. Pass --include-all to extract the archive verbatim instead.
#
# Usage:
#   unpack_export.sh <archive.zip> [--dest DIR] [--include-all] [--dry-run]

set -euo pipefail

ARCHIVE=""
DEST=""
INCLUDE_ALL=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)        DEST="$2"; shift 2 ;;
    --include-all) INCLUDE_ALL=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
    *)             ARCHIVE="$1"; shift ;;
  esac
done

[[ -z "$ARCHIVE" ]] && { echo "usage: unpack_export.sh <archive.zip> [--dest DIR]" >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "No such archive: $ARCHIVE" >&2; exit 1; }

DEST="${DEST:-$(pwd)/lighthouse-unpacked}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Directories excluded by default. Kept in sync with JUNK_DIRS in inspect_zip.py.
SKIP=(
  node_modules .venv venv __pycache__ .pytest_cache .mypy_cache .ruff_cache
  .tox dist build .next .nuxt .turbo .parcel-cache target .gradle
  .idea coverage .nyc_output .cache
)

echo "==> Surveying archive"
python3 "$SCRIPT_DIR/inspect_zip.py" "$ARCHIVE"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> Dry run; nothing extracted."
  exit 0
fi

exclude_args=()
if [[ $INCLUDE_ALL -eq 0 ]]; then
  # A single -x introduces the whole pattern list; repeating the flag would make
  # unzip read each "-x" as a pattern of its own.
  exclude_args+=(-x)
  for d in "${SKIP[@]}"; do
    exclude_args+=("*/$d/*" "$d/*")
  done
  echo "==> Extracting to $DEST (skipping ${#SKIP[@]} rebuildable directory types)"
else
  echo "==> Extracting to $DEST (verbatim, including dependencies)"
fi

mkdir -p "$DEST"
# unzip warns for every skip pattern the archive happens not to contain. That
# noise buries real errors, so drop just those lines and keep unzip's status.
set +e
unzip -q -o "$ARCHIVE" -d "$DEST" "${exclude_args[@]+"${exclude_args[@]}"}" \
  2> >(grep -v 'caution: excluded filename not matched' >&2)
unzip_status=${PIPESTATUS[0]}
set -e
# 0 = clean, 1 = extracted with warnings. Anything else is a real failure.
if [[ $unzip_status -gt 1 ]]; then
  echo "!! unzip failed with status $unzip_status" >&2
  exit "$unzip_status"
fi

# Collapse a single wrapping directory so the project root is the dest root.
shopt -s nullglob dotglob
entries=("$DEST"/*)
if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" ]]; then
  inner="${entries[0]}"
  echo "==> Collapsing wrapper directory $(basename "$inner")/"
  # A temporary sibling avoids the "move a directory into itself" case.
  tmp="$(mktemp -d "${DEST%/}.XXXXXX")"
  mv "$inner"/* "$tmp"/ 2>/dev/null || true
  rmdir "$inner"
  mv "$tmp"/* "$DEST"/ 2>/dev/null || true
  rmdir "$tmp"
fi
shopt -u nullglob dotglob

if [[ ! -f "$DEST/.gitignore" ]]; then
  echo "==> Writing .gitignore (none present in export)"
  {
    printf '%s\n' "# Dependencies and build output — restore with the project's install step"
    for d in "${SKIP[@]}"; do printf '%s/\n' "$d"; done
    printf '\n%s\n' "# Local environment — never commit"
    printf '%s\n' ".env" ".env.*" "!.env.example" "*.pem" "*.key" "id_rsa*"
    printf '\n%s\n' "# OS noise"
    printf '%s\n' ".DS_Store" "Thumbs.db" "*.log"
  } > "$DEST/.gitignore"
fi

echo
echo "==> Unpacked to $DEST"
echo "    $(find "$DEST" -type f | wc -l) files, $(du -sh "$DEST" | cut -f1) on disk"
echo
echo "Restore dependencies with whichever applies:"
# Lockfiles often sit one or two levels down (server/, web/, api/), not at root.
find_marker() { find "$DEST" -maxdepth 3 -name "$1" -not -path '*/node_modules/*' -print -quit 2>/dev/null; }
for marker in package-lock.json pnpm-lock.yaml yarn.lock requirements.txt pyproject.toml Cargo.toml go.mod Gemfile; do
  hit="$(find_marker "$marker")"
  [[ -z "$hit" ]] && continue
  where="$(dirname "${hit#$DEST/}")"
  prefix=""
  [[ "$where" != "." ]] && prefix="cd $where && "
  case "$marker" in
    package-lock.json) echo "    ${prefix}npm ci" ;;
    pnpm-lock.yaml)    echo "    ${prefix}pnpm install --frozen-lockfile" ;;
    yarn.lock)         echo "    ${prefix}yarn install --frozen-lockfile" ;;
    requirements.txt)  echo "    ${prefix}python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" ;;
    pyproject.toml)    echo "    ${prefix}python3 -m venv .venv && .venv/bin/pip install -e ." ;;
    Cargo.toml)        echo "    ${prefix}cargo build" ;;
    go.mod)            echo "    ${prefix}go mod download" ;;
    Gemfile)           echo "    ${prefix}bundle install" ;;
  esac
done
exit 0
