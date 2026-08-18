#!/usr/bin/env bash
# Exercises drive_fetch.sh against a local stand-in for Drive.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$TEST_DIR")"
WORK="$(mktemp -d)"
PORT=8731
PASS=0
FAIL=0

cleanup() {
  [[ -n "${SRV_PID:-}" ]] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

ok() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '\033[31m  FAIL  %s\033[0m\n' "$1"; [[ -n "${2:-}" ]] && printf '        %s\n' "$2"; }

# A real zip, so the script's archive verification has something to check.
cp "$TEST_DIR/fixtures/typical.zip" "$WORK/payload.zip"
EXPECTED_SUM="$(sha256sum "$WORK/payload.zip" | cut -d' ' -f1)"

python3 "$TEST_DIR/mock_drive.py" "$PORT" "$WORK/payload.zip" &
SRV_PID=$!

for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/uc?id=small" && break
  sleep 0.25
done

export DRIVE_UC_URL="http://127.0.0.1:$PORT/uc"
export DRIVE_DL_URL="http://127.0.0.1:$PORT/download"
export NO_PROXY="127.0.0.1,localhost"

fetch() { "$ROOT/scripts/drive_fetch.sh" "$1" "$2" 2>&1; }

printf '\n\033[1msmall file served directly\033[0m\n'
out="$(fetch small "$WORK/small.zip")"
if [[ -f "$WORK/small.zip" ]] && [[ "$(sha256sum "$WORK/small.zip" | cut -d' ' -f1)" == "$EXPECTED_SUM" ]]; then
  ok "downloads bytes intact"
else
  no "downloads bytes intact" "$out"
fi
grep -q "Served directly" <<<"$out" && ok "skips the confirmation flow" || no "skips the confirmation flow"

printf '\n\033[1mlarge file behind the confirmation form\033[0m\n'
out="$(fetch large "$WORK/large.zip")"
if [[ -f "$WORK/large.zip" ]] && [[ "$(sha256sum "$WORK/large.zip" | cut -d' ' -f1)" == "$EXPECTED_SUM" ]]; then
  ok "follows the form and gets intact bytes"
else
  no "follows the form and gets intact bytes" "$out"
fi
grep -q "Using confirmation form" <<<"$out" && ok "parses the hidden form inputs" || no "parses the hidden form inputs" "$out"
grep -q "Verified: readable zip" <<<"$out" && ok "verifies the archive is readable" || no "verifies the archive is readable" "$out"

printf '\n\033[1mlegacy cookie flow\033[0m\n'
out="$(fetch legacy "$WORK/legacy.zip")"
if [[ -f "$WORK/legacy.zip" ]] && [[ "$(sha256sum "$WORK/legacy.zip" | cut -d' ' -f1)" == "$EXPECTED_SUM" ]]; then
  ok "falls back to the cookie token"
else
  no "falls back to the cookie token" "$out"
fi

printf '\n\033[1mfile that is not link-shared\033[0m\n'
out="$(fetch private "$WORK/private.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "exits non-zero" || no "exits non-zero"
[[ ! -f "$WORK/private.zip" ]] && ok "leaves no HTML masquerading as a zip" || no "leaves no HTML masquerading as a zip"
grep -q "Anyone with the link" <<<"$out" && ok "explains the sharing requirement" || no "explains the sharing requirement" "$out"

printf '\n\033[1mtruncated transfer\033[0m\n'
out="$(fetch truncated "$WORK/trunc.zip")"; rc=$?
[[ $rc -ne 0 ]] && ok "exits non-zero on a corrupt archive" || no "exits non-zero on a corrupt archive"
grep -q "not a readable zip" <<<"$out" && ok "catches truncation before unpack time" || no "catches truncation before unpack time" "$out"

printf '\n%s\n' "────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m%s passed, 0 failed\033[0m\n' "$PASS"
else
  printf '\033[31m%s passed, %s failed\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi
