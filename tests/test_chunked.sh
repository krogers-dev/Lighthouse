#!/usr/bin/env bash
# Tests for chunked.sh — the git-transport path for oversized archives.
set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$TEST_DIR")"
WORK="$(mktemp -d)"
PASS=0; FAIL=0
trap 'rm -rf "$WORK"' EXIT
ok() { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf '\033[31m  FAIL  %s\033[0m\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; }

chunked() { "$ROOT/scripts/chunked.sh" "$@" 2>&1; }

# A 12MB archive split at 5MB gives 3 parts — same mechanics as 355MB at 90MB.
head -c 12000000 /dev/urandom > "$WORK/export.zip"
ORIG="$(sha256sum "$WORK/export.zip" | cut -d' ' -f1)"

printf '\n\033[1mround trip\033[0m\n'
out="$(CHUNK_SIZE=5m chunked split "$WORK/export.zip" "$WORK/xfer")"
n="$(ls "$WORK/xfer"/export.zip.part.* 2>/dev/null | wc -l)"
[[ "$n" -eq 3 ]] && ok "splits into the expected number of parts" || no "splits into the expected number of parts" "got $n"
[[ -f "$WORK/xfer/export.zip.manifest" ]] && ok "writes a manifest" || no "writes a manifest"

big="$(find "$WORK/xfer" -name '*.part.*' -size +100M | wc -l)"
[[ "$big" -eq 0 ]] && ok "no part exceeds GitHub's limit" || no "no part exceeds GitHub's limit"

out="$(chunked join "$WORK/xfer" "$WORK/restored.zip")"
[[ -f "$WORK/restored.zip" ]] && ok "reassembles a file" || no "reassembles a file" "$out"
[[ "$(sha256sum "$WORK/restored.zip" | cut -d' ' -f1)" == "$ORIG" ]] && ok "byte-identical to the original" || no "byte-identical to the original"
grep -q "Verified" <<<"$out" && ok "reports verification" || no "reports verification"

printf '\n\033[1mordering past 26 parts\033[0m\n'
head -c 3000000 /dev/urandom > "$WORK/many.zip"
M="$(sha256sum "$WORK/many.zip" | cut -d' ' -f1)"
CHUNK_SIZE=100k chunked split "$WORK/many.zip" "$WORK/many" >/dev/null
cnt="$(ls "$WORK/many"/many.zip.part.* | wc -l)"
[[ "$cnt" -gt 26 ]] && ok "produced $cnt parts (past the two-letter suffix range)" || no "produced enough parts" "got $cnt"
chunked join "$WORK/many" "$WORK/many_restored.zip" >/dev/null
[[ "$(sha256sum "$WORK/many_restored.zip" | cut -d' ' -f1)" == "$M" ]] && ok "reassembles in correct order past 26 parts" || no "reassembles in correct order past 26 parts"

printf '\n\033[1mcorruption and truncation are caught\033[0m\n'
cp -r "$WORK/xfer" "$WORK/bad"
printf 'XXXX' | dd of="$WORK/bad/export.zip.part.001" bs=1 seek=500 conv=notrunc status=none
out="$(chunked join "$WORK/bad" "$WORK/bad.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "exits non-zero on a corrupted part" || no "exits non-zero on a corrupted part"
grep -q "Checksum mismatch" <<<"$out" && ok "names the checksum mismatch" || no "names the checksum mismatch"
[[ ! -f "$WORK/bad.zip" ]] && ok "removes the corrupt output" || no "removes the corrupt output"

cp -r "$WORK/xfer" "$WORK/short" && rm "$WORK/short/export.zip.part.002"
out="$(chunked join "$WORK/short" "$WORK/short.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "exits non-zero when a part is missing" || no "exits non-zero when a part is missing"
grep -q "incomplete" <<<"$out" && ok "explains the missing part" || no "explains the missing part" "$out"

printf '\n\033[1mbad input\033[0m\n'
out="$(chunked join "$WORK" "$WORK/nope.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "refuses a directory with no manifest" || no "refuses a directory with no manifest"
out="$(chunked split "$WORK/absent.zip" "$WORK/x")"; rc=$?
[[ $rc -ne 0 ]] && ok "refuses a missing archive" || no "refuses a missing archive"

printf '\n%s\n' "────────────────────────────────────────"
[[ $FAIL -eq 0 ]] && printf '\033[32m%s passed, 0 failed\033[0m\n' "$PASS" || { printf '\033[31m%s passed, %s failed\033[0m\n' "$PASS" "$FAIL"; exit 1; }
