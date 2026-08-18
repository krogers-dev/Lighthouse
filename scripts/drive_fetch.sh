#!/usr/bin/env bash
# Download a link-shared Google Drive file by ID.
#
# Drive refuses to stream files over roughly 100MB directly. It answers the
# download URL with an HTML page instead, and the real bytes only come from a
# second request carrying a confirmation token. A plain curl of a share link
# therefore yields a few kilobytes of HTML that looks nothing like a zip, which
# is the usual reason "the download worked but the file is corrupt".
#
# Both the current form-based flow and the older cookie-based one are handled.
#
# Usage: drive_fetch.sh <file-id> <output-path>
#
# The endpoints are overridable so the flow can be exercised against a local
# stand-in; see tests/test_drive_fetch.sh.

set -euo pipefail

UC_URL="${DRIVE_UC_URL:-https://drive.google.com/uc}"
DL_URL="${DRIVE_DL_URL:-https://drive.usercontent.google.com/download}"

FILE_ID="${1:?usage: drive_fetch.sh <file-id> <output-path>}"
OUT="${2:?usage: drive_fetch.sh <file-id> <output-path>}"

WORK="$(mktemp -d)"
COOKIES="$WORK/cookies"
BODY="$WORK/body"
HEADERS="$WORK/headers"
trap 'rm -rf "$WORK"' EXIT

echo "==> Requesting $FILE_ID"

curl -sSL --fail-with-body \
  --cookie-jar "$COOKIES" --cookie "$COOKIES" \
  -D "$HEADERS" -o "$BODY" \
  "${UC_URL}?export=download&id=${FILE_ID}"

# Content-Type is the reliable signal. Sniffing for a "<!DOCTYPE html>" prefix
# misses pages that open with a comment, a BOM, or different capitalisation.
content_type="$(tr -d '\r' < "$HEADERS" | grep -i '^content-type:' | tail -1 | cut -d: -f2- | tr -d ' ' || true)"

if [[ "$content_type" != text/html* ]]; then
  echo "==> Served directly (${content_type:-unknown type})"
  mv "$BODY" "$OUT"
  echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"
  exit 0
fi

echo "==> Confirmation page returned; extracting token"

# Current flow: an HTML form whose hidden inputs carry the confirmation token.
# Rebuild it as a GET, since that is what the form submits.
# No form on the page is an expected outcome, not an error: the legacy flow
# and the sign-in page both lack one, and both are handled below.
form_action="$(grep -o 'action="[^"]*"' "$BODY" | head -1 |
               sed 's/action="//; s/"$//; s/&amp;/\&/g' || true)"

url=""
if [[ -n "$form_action" ]]; then
  query=""
  while IFS= read -r input; do
    name="$(sed -n 's/.*[^a-z]name="\([^"]*\)".*/\1/p' <<<"$input")"
    value="$(sed -n 's/.*value="\([^"]*\)".*/\1/p' <<<"$input")"
    [[ -z "$name" ]] && continue
    query+="${query:+&}${name}=${value}"
  done < <(grep -o '<input[^>]*>' "$BODY")

  if [[ -n "$query" ]]; then
    url="${form_action}?${query}"
    echo "==> Using confirmation form"
  fi
fi

if [[ -z "$url" ]]; then
  # Legacy flow: the token arrives as a download_warning cookie, or is simply
  # absent, in which case Drive accepts the literal "t".
  token="$(awk '/download_warning/ {print $NF}' "$COOKIES" 2>/dev/null | tail -1 || true)"
  [[ -z "$token" ]] && token="t"
  url="${DL_URL}?id=${FILE_ID}&export=download&confirm=${token}"
  echo "==> Using cookie token"
fi

echo "==> Downloading"
# -C - resumes a partial transfer, which matters for a multi-hundred-megabyte
# file over a proxy that may drop the connection.
curl -L --fail-with-body --progress-bar -C - \
  --cookie-jar "$COOKIES" --cookie "$COOKIES" \
  --retry 4 --retry-delay 2 --retry-all-errors \
  -D "$HEADERS" -o "$OUT" "$url"

final_type="$(tr -d '\r' < "$HEADERS" | grep -i '^content-type:' | tail -1 | cut -d: -f2- | tr -d ' ' || true)"
if [[ "$final_type" == text/html* ]]; then
  echo "!! Drive returned a web page instead of file bytes." >&2
  echo "!! The file is most likely not shared as 'Anyone with the link'," >&2
  echo "!! or it needs a sign-in this script cannot perform." >&2
  rm -f "$OUT"
  exit 1
fi

echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# A truncated transfer is worth catching here rather than at unzip time.
if [[ "$OUT" == *.zip ]] && command -v python3 >/dev/null; then
  if python3 -c "import zipfile,sys; sys.exit(0 if zipfile.is_zipfile('$OUT') else 1)"; then
    echo "==> Verified: readable zip archive"
  else
    echo "!! Downloaded file is not a readable zip; the transfer may be incomplete." >&2
    exit 1
  fi
fi
