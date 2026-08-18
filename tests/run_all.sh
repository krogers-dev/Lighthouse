#!/usr/bin/env bash
# Runs every test suite. Exits non-zero if any of them fail.
set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Rebuilding fixtures"
python3 "$TEST_DIR/make_fixtures.py" >/dev/null

rc=0
for suite in run_tests.sh test_drive_fetch.sh test_restore_state.sh; do
  printf '\n\033[1m═══ %s ═══\033[0m\n' "$suite"
  "$TEST_DIR/$suite" || rc=1
done

printf '\n%s\n' "════════════════════════════════════════"
[[ $rc -eq 0 ]] && printf '\033[32mall suites passed\033[0m\n' || printf '\033[31msome suites failed\033[0m\n'
exit $rc
