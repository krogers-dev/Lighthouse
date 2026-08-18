#!/usr/bin/env bash
# Restore a Claude Code state archive (~/.claude) onto a new machine.
#
# This is deliberately not a plain unzip over the top of ~/.claude. Three things
# make a naive restore go wrong:
#
#   1. An existing ~/.claude on the new machine gets silently clobbered.
#   2. Conversation history is keyed by the absolute working directory of the
#      project, so history from /Users/you/proj is invisible to a checkout at
#      /home/you/code/proj unless the keys are rewritten.
#   3. Stored credentials are machine- and account-bound, and copying them
#      around is the wrong default.
#
# Reports a plan and changes nothing unless --apply is passed.
#
# Usage:
#   restore_claude_state.sh <ClaudeState.zip> [options]
#
#   --apply                 perform the restore (default is a dry run)
#   --target DIR            destination (default: ~/.claude)
#   --remap OLD=NEW         rewrite project history keys from path OLD to NEW
#   --include-credentials   also restore .credentials.json (off by default)
#   --no-backup             skip backing up an existing target

set -euo pipefail

ARCHIVE=""
TARGET="$HOME/.claude"
APPLY=0
BACKUP=1
INCLUDE_CREDS=0
REMAP_FROM=""
REMAP_TO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)               APPLY=1; shift ;;
    --target)              TARGET="$2"; shift 2 ;;
    --no-backup)           BACKUP=0; shift ;;
    --include-credentials) INCLUDE_CREDS=1; shift ;;
    --remap)
      REMAP_FROM="${2%%=*}"; REMAP_TO="${2#*=}"
      [[ "$REMAP_FROM" == "$2" ]] && { echo "--remap needs OLD=NEW" >&2; exit 1; }
      shift 2 ;;
    -h|--help)             sed -n '2,25p' "$0"; exit 0 ;;
    *)                     ARCHIVE="$1"; shift ;;
  esac
done

[[ -z "$ARCHIVE" ]] && { echo "usage: restore_claude_state.sh <ClaudeState.zip> [--apply]" >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "No such archive: $ARCHIVE" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

python3 -c "import zipfile,sys; sys.exit(0 if zipfile.is_zipfile(sys.argv[1]) else 1)" "$ARCHIVE" \
  || { echo "Not a readable zip archive: $ARCHIVE" >&2; exit 1; }

echo "==> Extracting to a staging directory (nothing is overwritten yet)"
unzip -q -o "$ARCHIVE" -d "$STAGE"

# The archive may or may not wrap everything in a .claude/ directory.
SRC="$STAGE"
if [[ -d "$STAGE/.claude" ]]; then
  SRC="$STAGE/.claude"
else
  shopt -s nullglob
  dirs=("$STAGE"/*/)
  shopt -u nullglob
  if [[ ${#dirs[@]} -eq 1 && ! -e "$STAGE/settings.json" && ! -d "$STAGE/projects" ]]; then
    SRC="${dirs[0]%/}"
    [[ -d "$SRC/.claude" ]] && SRC="$SRC/.claude"
  fi
fi

echo "==> Archive contents"
for entry in "$SRC"/* "$SRC"/.[!.]*; do
  [[ -e "$entry" ]] || continue
  name="$(basename "$entry")"
  size="$(du -sh "$entry" 2>/dev/null | cut -f1)"
  note=""
  case "$name" in
    .credentials.json) note="  <- sensitive; skipped unless --include-credentials" ;;
    projects)          note="  <- conversation history, keyed by project path" ;;
    skills)            note="  <- custom skills" ;;
    plugins)           note="  <- installed plugins" ;;
    settings.json)     note="  <- user settings" ;;
  esac
  printf '  %6s  %s%s\n' "$size" "$name" "$note"
done

# --- project history keys ---------------------------------------------------
# Claude Code names each project directory after its absolute working directory
# with the separators replaced by dashes, so the keys reveal the old layout.
if [[ -d "$SRC/projects" ]]; then
  echo
  echo "==> Project history keys in the archive"
  shopt -s nullglob
  for pdir in "$SRC/projects"/*/; do
    key="$(basename "$pdir")"
    restored="${key//-//}"
    count="$(find "$pdir" -type f 2>/dev/null | wc -l)"
    marker=""
    [[ -d "$restored" ]] && marker="  (exists here)" || marker="  (no such path on this machine)"
    printf '  %-45s %4s sessions  %s%s\n' "$key" "$count" "$restored" "$marker"
  done
  shopt -u nullglob

  if [[ -z "$REMAP_FROM" ]]; then
    echo
    echo "  If a project lives at a different path on this machine, its history"
    echo "  will not be found. Rewrite the key with, for example:"
    echo "    --remap /Users/you/lighthouse=$HOME/code/lighthouse"
  fi
fi

# --- plan -------------------------------------------------------------------
echo
echo "==> Plan"
if [[ -e "$TARGET" ]]; then
  echo "  Target exists: $TARGET ($(du -sh "$TARGET" 2>/dev/null | cut -f1))"
  if [[ $BACKUP -eq 1 ]]; then
    echo "  Back it up to: $TARGET.backup-<timestamp>"
  else
    echo "  !! --no-backup given; existing files will be overwritten in place"
  fi
else
  echo "  Target does not exist yet: $TARGET"
fi

if [[ $INCLUDE_CREDS -eq 0 && -e "$SRC/.credentials.json" ]]; then
  echo "  Skip .credentials.json (sign in on this machine instead)"
fi
if [[ -n "$REMAP_FROM" ]]; then
  old_key="${REMAP_FROM//\//-}"
  new_key="${REMAP_TO//\//-}"
  echo "  Rename project key: $old_key"
  echo "                  ->  $new_key"
fi

if [[ $APPLY -eq 0 ]]; then
  echo
  echo "Dry run. Nothing was changed. Re-run with --apply to perform the restore."
  exit 0
fi

# --- apply ------------------------------------------------------------------
echo
if [[ -e "$TARGET" && $BACKUP -eq 1 ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  echo "==> Backing up $TARGET -> $TARGET.backup-$stamp"
  cp -a "$TARGET" "$TARGET.backup-$stamp"
fi

if [[ -n "$REMAP_FROM" && -d "$SRC/projects" ]]; then
  old_key="${REMAP_FROM//\//-}"
  new_key="${REMAP_TO//\//-}"
  if [[ -d "$SRC/projects/$old_key" ]]; then
    echo "==> Remapping project history to the new path"
    mv "$SRC/projects/$old_key" "$SRC/projects/$new_key"
  else
    echo "!! No project key matching $old_key; nothing to remap." >&2
  fi
fi

[[ $INCLUDE_CREDS -eq 0 ]] && rm -f "$SRC/.credentials.json"

mkdir -p "$TARGET"
echo "==> Merging into $TARGET"
# cp -a preserves modes and timestamps; existing files not present in the
# archive are left alone, which is what makes this a merge rather than a swap.
shopt -s dotglob
cp -a "$SRC"/* "$TARGET"/
shopt -u dotglob

echo
echo "==> Restored to $TARGET"
echo "    $(find "$TARGET" -type f | wc -l) files, $(du -sh "$TARGET" | cut -f1)"
[[ $INCLUDE_CREDS -eq 0 ]] && echo "    Run 'claude' and sign in; credentials were not copied."
