#!/usr/bin/env bash
# Tests for restore_claude_state.sh. Every case runs against a temporary target
# directory; the real ~/.claude is never touched.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$TEST_DIR")"
WORK="$(mktemp -d)"
PASS=0
FAIL=0
trap 'rm -rf "$WORK"' EXIT

ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '\033[31m  FAIL  %s\033[0m\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; }
has() { grep -qF -- "$2" <<<"$1" && ok "$3" || no "$3" "expected: $2"; }
hasnt() { grep -qF -- "$2" <<<"$1" && no "$3" "should not contain: $2" || ok "$3"; }

# A state archive shaped like a real ~/.claude from another machine.
build_archive() {
  local root="$WORK/src/.claude"
  rm -rf "$WORK/src"
  mkdir -p "$root/projects/-Users-kody-lighthouse" \
           "$root/projects/-Users-kody-other" \
           "$root/skills/my-skill" "$root/plugins"
  echo '{"model":"opus"}'            > "$root/settings.json"
  echo '{"token":"SECRET-DO-NOT-COPY"}' > "$root/.credentials.json"
  echo '{"session":1}'               > "$root/projects/-Users-kody-lighthouse/abc.jsonl"
  echo '{"session":2}'               > "$root/projects/-Users-kody-lighthouse/def.jsonl"
  echo '{"session":3}'               > "$root/projects/-Users-kody-other/ghi.jsonl"
  echo '# skill'                     > "$root/skills/my-skill/SKILL.md"
  (cd "$WORK/src" && zip -qr "$WORK/state.zip" .claude)
}
build_archive

restore() { "$ROOT/scripts/restore_claude_state.sh" "$@" 2>&1; }

printf '\n\033[1mdry run is the default\033[0m\n'
target="$WORK/t1"
out="$(restore "$WORK/state.zip" --target "$target")"
[[ ! -e "$target" ]] && ok "writes nothing without --apply" || no "writes nothing without --apply"
has "$out" "Dry run"                       "says it was a dry run"
has "$out" "-Users-kody-lighthouse"        "lists project history keys"
has "$out" "no such path on this machine"  "flags keys that do not resolve here"
has "$out" "Skip .credentials.json"        "plans to skip credentials"
has "$out" "--remap"                       "suggests remapping"

printf '\n\033[1mapplying to a fresh target\033[0m\n'
target="$WORK/t2"
out="$(restore "$WORK/state.zip" --target "$target" --apply)"
[[ -f "$target/settings.json" ]] && ok "restores settings" || no "restores settings"
[[ -f "$target/skills/my-skill/SKILL.md" ]] && ok "restores skills" || no "restores skills"
[[ -f "$target/projects/-Users-kody-lighthouse/abc.jsonl" ]] && ok "restores history" || no "restores history"
[[ ! -e "$target/.credentials.json" ]] && ok "omits credentials by default" || no "omits credentials by default"

printf '\n\033[1mcredentials only on request\033[0m\n'
target="$WORK/t3"
restore "$WORK/state.zip" --target "$target" --apply --include-credentials >/dev/null
[[ -f "$target/.credentials.json" ]] && ok "--include-credentials restores them" || no "--include-credentials restores them"

printf '\n\033[1mexisting state is backed up, not clobbered\033[0m\n'
target="$WORK/t4"
mkdir -p "$target"
echo '{"model":"sonnet","mine":true}' > "$target/settings.json"
echo 'local only' > "$target/local-note.txt"
out="$(restore "$WORK/state.zip" --target "$target" --apply)"
backup="$(find "$WORK" -maxdepth 1 -name 't4.backup-*' -type d | head -1)"
[[ -n "$backup" ]] && ok "creates a timestamped backup" || no "creates a timestamped backup"
grep -q 'sonnet' "$backup/settings.json" 2>/dev/null && ok "backup holds the previous settings" || no "backup holds the previous settings"
[[ -f "$target/local-note.txt" ]] && ok "keeps local files absent from the archive" || no "keeps local files absent from the archive"
grep -q 'opus' "$target/settings.json" && ok "archive settings win on conflict" || no "archive settings win on conflict"

printf '\n\033[1mremapping project history\033[0m\n'
target="$WORK/t5"
newpath="$WORK/code/lighthouse"
mkdir -p "$newpath"
expected_key="${newpath//\//-}"
out="$(restore "$WORK/state.zip" --target "$target" --apply --remap "/Users/kody/lighthouse=$newpath")"
[[ -d "$target/projects/$expected_key" ]] && ok "renames the key to the new path" || no "renames the key to the new path" "looked for $expected_key"
[[ -f "$target/projects/$expected_key/abc.jsonl" ]] && ok "history moves with the key" || no "history moves with the key"
[[ ! -d "$target/projects/-Users-kody-lighthouse" ]] && ok "old key is gone" || no "old key is gone"
[[ -d "$target/projects/-Users-kody-other" ]] && ok "leaves other projects alone" || no "leaves other projects alone"

printf '\n\033[1mbad input\033[0m\n'
out="$(restore "$WORK/state.zip" --target "$WORK/t6" --remap "no-equals-sign")"; rc=$?
[[ $rc -ne 0 ]] && ok "rejects a malformed --remap" || no "rejects a malformed --remap"
head -c 5000 /dev/urandom > "$WORK/junk.zip"
out="$(restore "$WORK/junk.zip" --target "$WORK/t7")"; rc=$?
[[ $rc -ne 0 ]] && ok "rejects a corrupt archive" || no "rejects a corrupt archive"
has "$out" "Not a readable zip" "explains a corrupt archive"
out="$(restore "$WORK/missing.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "rejects a missing archive" || no "rejects a missing archive"

printf '\n\033[1marchive without a .claude wrapper\033[0m\n'
rm -rf "$WORK/flat" && mkdir -p "$WORK/flat/projects/-Users-kody-lighthouse"
echo '{"model":"opus"}' > "$WORK/flat/settings.json"
echo '{"s":1}' > "$WORK/flat/projects/-Users-kody-lighthouse/a.jsonl"
(cd "$WORK/flat" && zip -qr "$WORK/flat.zip" .)
target="$WORK/t8"
restore "$WORK/flat.zip" --target "$target" --apply >/dev/null
[[ -f "$target/settings.json" ]] && ok "handles a flat archive layout" || no "handles a flat archive layout"

printf '\n%s\n' "────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then printf '\033[32m%s passed, 0 failed\033[0m\n' "$PASS"
else printf '\033[31m%s passed, %s failed\033[0m\n' "$PASS" "$FAIL"; exit 1; fi
