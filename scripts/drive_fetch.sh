#!/usr/bin/env bash
# Download a link-shared Google Drive file by ID.
#
# Handles the large-file interstitial: Drive refuses to stream files over ~100MB
# directly and instead answers with an HTML page containing a confirmation form.
# Both the legacy cookie flow and the current drive.usercontent.google.com form
# flow are handled below.
#
# Usage: drive_fetch.sh <file-id> <output-path>

set -euo pipefail

FILE_ID="${1:?usage: drive_fetch.sh <file-id> <output-path>}"
OUT="${2:?usage: drive_fetch.sh <file-id> <output-path>}"

COOKIES="$(mktemp)"
PROBE="$(mktemp)"
trap 'rm -f "$COOKIES" "$PROBE"' EXIT

echo "==> Requesting file $FILE_ID"

# First request. Small files stream straight through; large ones return HTML.
curl -sSL --fail-with-body \
  --cookie-jar "$COOKIES" --cookie "$COOKIES" \
  -o "$PROBE" \
  "https://drive.google.com/uc?export=download&id=${FILE_ID}"

if [[ "$(head -c 15 "$PROBE")" != "<!DOCTYPE html>" ]]; then
  echo "==> Served directly (no confirmation needed)"
  mv "$PROBE" "$OUT"
  echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"
  exit 0
fi

echo "==> Large-file interstitial returned; extracting confirmation token"

# Current flow: an HTML form posting to drive.usercontent.google.com/download
# with hidden id / export / confirm / uuid inputs. Rebuild it as a GET.
form_action="$(grep -o 'action="[^"]*"' "$PROBE" | head -1 | sed 's/action="//;s/"$//' | sed 's/&amp;/\&/g')"

if [[ -n "$form_action" ]]; then
  query=""
  while IFS= read -r input; do
    name="$(sed -n 's/.*name="\([^"]*\)".*/\1/p' <<<"$input")"
    value="$(sed -n 's/.*value="\([^"]*\)".*/\1/p' <<<"$input")"
    [[ -z "$name" ]] && continue
    query+="${query:+&}${name}=${value}"
  done < <(grep -o '<input[^>]*>' "$PROBE")

  url="${form_action}?${query}"
else
  # Legacy flow: the confirm token arrives as a download_warning cookie.
  token="$(awk '/download_warning/ {print $NF}' "$COOKIES" | tail -1)"
  [[ -z "$token" ]] && token="t"
  url="https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=${token}"
fi

echo "==> Downloading (resumable)"
# -C - resumes a partial file; large transfers over a proxy do get interrupted.
curl -L --fail-with-body --progress-bar -C - \
  --cookie-jar "$COOKIES" --cookie "$COOKIES" \
  --retry 4 --retry-delay 2 --retry-all-errors \
  -o "$OUT" "$url"

if [[ "$(head -c 15 "$OUT")" == "<!DOCTYPE html>" ]]; then
  echo "!! Got an HTML page instead of file bytes." >&2
  echo "!! The file is probably not link-shared, or Drive wants a login." >&2
  echo "!! Check sharing is set to 'Anyone with the link'." >&2
  exit 1
fi

echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"
