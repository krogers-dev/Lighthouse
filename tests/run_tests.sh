#!/usr/bin/env bash
# Regression tests for the export-unpacking tooling.
#
# Usage: tests/run_tests.sh [name-filter]

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$TEST_DIR")"
FIX="$TEST_DIR/fixtures"
WORK="$(mktemp -d)"
FILTER="${1:-}"

PASS=0
FAIL=0
FAILED_NAMES=()

trap 'rm -rf "$WORK"' EXIT

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
no() {
  FAIL=$((FAIL + 1))
  FAILED_NAMES+=("$1")
  red "  FAIL  $1"
  [[ -n "${2:-}" ]] && printf '        %s\n' "$2"
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if grep -qF -- "$needle" <<<"$haystack"; then ok "$label"
  else no "$label" "expected to find: $needle"; fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if grep -qF -- "$needle" <<<"$haystack"; then no "$label" "should NOT contain: $needle"
  else ok "$label"; fi
}

assert_file() {
  [[ -e "$1" ]] && ok "$2" || no "$2" "missing: $1"
}

assert_no_file() {
  [[ -e "$1" ]] && no "$2" "should not exist: $1" || ok "$2"
}

run_case() {
  [[ -n "$FILTER" && "$1" != *"$FILTER"* ]] && return 1
  printf '\n\033[1m%s\033[0m\n' "$1"
  return 0
}

survey() { python3 "$ROOT/scripts/inspect_zip.py" "$@" 2>&1; }
unpack() { "$ROOT/scripts/unpack_export.sh" "$@" 2>&1; }

# ---------------------------------------------------------------------------
if run_case "typical export"; then
  out="$(survey "$FIX/typical.zip")"
  assert_contains "$out" "single root dir   LighthouseExport/" "detects the wrapper directory"
  assert_contains "$out" "node_modules"                        "reports node_modules as rebuildable"
  assert_contains "$out" "Node / npm"                          "detects the Node stack"
  assert_contains "$out" "Python (pip)"                        "detects the Python stack"
  assert_contains "$out" "Claude Code project instructions"    "detects CLAUDE.md"
  assert_contains "$out" ".env"                                "flags the .env file"
  assert_contains "$out" "Source-only payload"                 "separates source from dependencies"

  dest="$WORK/typical"
  out="$(unpack "$FIX/typical.zip" --dest "$dest")"
  assert_file    "$dest/package.json"             "collapses wrapper, source at root"
  assert_file    "$dest/src/index.ts"             "extracts nested source"
  assert_file    "$dest/.env"                     "keeps .env on disk for the migration"
  assert_file    "$dest/.gitignore"               "writes a .gitignore"
  assert_no_file "$dest/node_modules"             "excludes node_modules"
  assert_no_file "$dest/.venv"                    "excludes .venv"
  assert_no_file "$dest/dist"                     "excludes dist"
  assert_no_file "$dest/__pycache__"              "excludes __pycache__"
  assert_contains "$out" "npm ci"                 "suggests npm ci from the lockfile"
  assert_contains "$out" "cd server"              "finds the nested requirements.txt"
  assert_not_contains "$out" "caution:"           "suppresses unzip pattern noise"

  ignored="$(cd "$dest" && git init -q . >/dev/null 2>&1 && git status --porcelain --ignored 2>/dev/null)"
  assert_contains "$ignored" "!! .env" "the generated .gitignore actually ignores .env"
fi

# ---------------------------------------------------------------------------
if run_case "archive with no wrapper directory"; then
  dest="$WORK/nowrap"
  unpack "$FIX/no_wrapper.zip" --dest "$dest" >/dev/null
  assert_file    "$dest/package.json"  "leaves root-level files in place"
  assert_file    "$dest/src/index.ts"  "keeps subdirectories"
  assert_no_file "$dest/node_modules"  "still excludes dependencies"
fi

# ---------------------------------------------------------------------------
if run_case "archive with several top-level directories"; then
  dest="$WORK/multi"
  unpack "$FIX/multi_root.zip" --dest "$dest" >/dev/null
  assert_file "$dest/frontend/package.json"   "keeps the first root"
  assert_file "$dest/backend/pyproject.toml"  "keeps the second root"
  assert_file "$dest/README.md"               "keeps root-level files"
fi

# ---------------------------------------------------------------------------
if run_case "awkward filenames"; then
  dest="$WORK/odd"
  unpack "$FIX/odd_names.zip" --dest "$dest" >/dev/null
  assert_file "$dest/my project/file with spaces.txt" "handles spaces in paths"
  assert_file "$dest/unicode/café-données.md"          "handles accented filenames"
  assert_file "$dest/unicode/日本語.txt"                "handles non-latin filenames"
  assert_file "$dest/dash/-leading-dash.txt"           "handles leading-dash filenames"
  deep="$dest/deep/$(printf 'lvl%s/' $(seq 1 15) | sed 's|/$||')/deep.txt"
  assert_file "$deep" "handles deeply nested paths"
fi

# ---------------------------------------------------------------------------
if run_case "path traversal (zip slip)"; then
  canary_tmp="/tmp/zipslip_escaped.txt"
  canary_abs="/tmp/zipslip_absolute.txt"
  rm -f "$canary_tmp" "$canary_abs"
  dest="$WORK/malicious"
  unpack "$FIX/malicious.zip" --dest "$dest" >/dev/null 2>&1
  assert_no_file "$canary_tmp"                   "does not write through ../ traversal"
  assert_no_file "$canary_abs"                   "does not honour absolute paths"
  assert_no_file "$WORK/zipslip_relative.txt"    "does not escape into the parent directory"
  escaped="$(find "$WORK" -maxdepth 1 -name 'zipslip*' 2>/dev/null)"
  [[ -z "$escaped" ]] && ok "nothing escaped the destination" \
                      || no "nothing escaped the destination" "$escaped"
fi

# ---------------------------------------------------------------------------
if run_case "symlink entries"; then
  dest="$WORK/symlink"
  unpack "$FIX/symlink.zip" --dest "$dest" >/dev/null 2>&1
  assert_file "$dest/real.txt" "extracts regular files alongside links"
  if [[ -L "$dest/link_to_etc" ]]; then
    target="$(readlink "$dest/link_to_etc")"
    ok "preserves the symlink (target: $target)"
  else
    ok "symlink not materialised as a link"
  fi
fi

# ---------------------------------------------------------------------------
if run_case "archive that is entirely rebuildable"; then
  out="$(survey "$FIX/all_junk.zip")"
  assert_contains "$out" "100% of archive" "reports the archive as fully rebuildable"
  dest="$WORK/junk"
  out="$(unpack "$FIX/all_junk.zip" --dest "$dest")"
  count="$(find "$dest" -type f ! -name '.gitignore' | wc -l)"
  [[ "$count" -eq 0 ]] && ok "extracts no source files" || no "extracts no source files" "found $count"
fi

# ---------------------------------------------------------------------------
if run_case "degenerate archives"; then
  out="$(survey "$FIX/empty.zip")"; rc=$?
  assert_contains "$out" "no files" "reports an empty archive"
  [[ $rc -ne 0 ]] && ok "exits non-zero on an empty archive" || no "exits non-zero on an empty archive"

  out="$(survey "$FIX/corrupt.zip")"; rc=$?
  assert_contains "$out" "Not a readable zip" "reports a corrupt archive"
  [[ $rc -ne 0 ]] && ok "exits non-zero on a corrupt archive" || no "exits non-zero on a corrupt archive"

  out="$(unpack "$FIX/corrupt.zip" --dest "$WORK/corrupt")"; rc=$?
  [[ $rc -ne 0 ]] && ok "unpack refuses a corrupt archive" || no "unpack refuses a corrupt archive"

  out="$(unpack "$FIX/does_not_exist.zip" --dest "$WORK/nope")"; rc=$?
  [[ $rc -ne 0 ]] && ok "unpack refuses a missing archive" || no "unpack refuses a missing archive"
  assert_contains "$out" "No such archive" "explains a missing archive"
fi

# ---------------------------------------------------------------------------
if run_case "encrypted entries"; then
  out="$(survey "$FIX/encrypted.zip")"
  assert_contains "$out" "encrypted" "reports password-protected entries"
fi

# ---------------------------------------------------------------------------
if run_case "files over GitHub size limits"; then
  out="$(survey "$FIX/oversized.zip")"
  assert_contains "$out" "over GitHub's 100MB limit" "warns about files git will reject"
fi

# ---------------------------------------------------------------------------
if run_case "paths from the source machine"; then
  out="$(survey "$FIX/hardcoded_paths.zip" --deep)"
  assert_contains "$out" "/Users/kody"           "finds macOS home paths"
  assert_contains "$out" 'C:\Users\kody'         "finds Windows home paths"
  assert_contains "$out" ".env"                  "scans extensionless dotfiles"
  assert_contains "$out" ".vscode/settings.json" "scans editor config"
  assert_contains "$out" "scripts/run.sh"        "scans shell scripts"
  assert_contains "$out" "notes.md"              "scans markdown"
  assert_not_contains "$out" ".venv/bin/activate"    "ignores paths inside .venv"
  assert_not_contains "$out" "node_modules/x/cfg"    "ignores paths inside node_modules"

  out="$(survey "$FIX/hardcoded_paths.zip")"
  assert_not_contains "$out" "HARD-CODED PATHS" "path scan only runs under --deep"

  dest="$WORK/paths"
  unpack "$FIX/hardcoded_paths.zip" --dest "$dest" >/dev/null
  assert_file "$dest/.vscode/settings.json" "preserves VS Code config"
  assert_file "$dest/.idea/workspace.xml"   "preserves JetBrains config"
  assert_no_file "$dest/.venv"              "still drops the virtualenv"
fi

# ---------------------------------------------------------------------------
if run_case "symlinks appear in the survey"; then
  out="$(survey "$FIX/symlink.zip")"
  assert_contains "$out" "SYMLINKS"    "reports a symlink section"
  assert_contains "$out" "/etc/passwd" "names the link target"
  assert_contains "$out" "absolute"    "marks absolute targets as dangling risks"
fi

# ---------------------------------------------------------------------------
if run_case "oversized files are called out after extraction"; then
  dest="$WORK/oversize"
  out="$(unpack "$FIX/oversized.zip" --dest "$dest")"
  assert_contains "$out" "exceed GitHub's 100MB limit" "warns after extraction, not just in the survey"
  assert_contains "$out" "assets/model.bin"            "names the offending file"
  assert_contains "$out" "Git LFS"                     "suggests a remedy"
fi

# ---------------------------------------------------------------------------
if run_case "dry run writes nothing"; then
  dest="$WORK/dryrun"
  out="$(unpack "$FIX/typical.zip" --dest "$dest" --dry-run)"
  assert_no_file  "$dest"                 "dry run creates no destination"
  assert_contains "$out" "TOP-LEVEL LAYOUT" "dry run still reports the survey"
fi

# ---------------------------------------------------------------------------
if run_case "include-all mode"; then
  dest="$WORK/all"
  unpack "$FIX/typical.zip" --dest "$dest" --include-all >/dev/null
  assert_file "$dest/node_modules/react/index.js" "--include-all keeps dependencies"
  assert_file "$dest/package.json"                "--include-all still collapses the wrapper"
fi

# ---------------------------------------------------------------------------
printf '\n%s\n' "────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  green "$PASS passed, 0 failed"
else
  red "$PASS passed, $FAIL failed"
  for n in "${FAILED_NAMES[@]}"; do printf '  - %s\n' "$n"; done
  exit 1
fi
