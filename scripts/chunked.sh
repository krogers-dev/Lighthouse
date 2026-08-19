#!/usr/bin/env bash
# Move a large archive through git, which is the transport already available
# when an export cannot be downloaded directly.
#
# GitHub rejects any single file over 100MB, so the archive is split into parts
# below that limit, committed, and reassembled on the other side. A checksum is
# carried alongside so reassembly is verified rather than assumed.
#
# On the machine that has the archive:
#   chunked.sh split ~/Downloads/LighthouseExport_2026-08-17.zip transfer/
#   git add transfer && git commit -m "Transfer export" && git push
#
# On the machine that needs it:
#   chunked.sh join transfer/ ~/LighthouseExport.zip
#
# Delete the transfer branch afterwards; this is a courier, not storage.

set -euo pipefail

CHUNK_SIZE="${CHUNK_SIZE:-90m}"   # under GitHub's 100MB hard limit

usage() { sed -n '2,20p' "$0"; exit "${1:-0}"; }

sum_file() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi   # macOS has shasum, not sha256sum
}

cmd_split() {
  local archive="${1:?usage: chunked.sh split <archive> <outdir>}"
  local outdir="${2:?usage: chunked.sh split <archive> <outdir>}"
  [[ -f "$archive" ]] || { echo "No such file: $archive" >&2; exit 1; }

  mkdir -p "$outdir"
  local base; base="$(basename "$archive")"

  echo "==> Checksumming $base ($(du -h "$archive" | cut -f1))"
  local sum; sum="$(sum_file "$archive")"

  echo "==> Splitting into ${CHUNK_SIZE} parts"
  # Numeric suffixes sort correctly past 26 parts, where letters would not.
  split -b "$CHUNK_SIZE" -d -a 3 "$archive" "$outdir/$base.part."

  { echo "name=$base"; echo "sha256=$sum"; echo "parts=$(ls "$outdir/$base.part."* | wc -l | tr -d ' ')"; } > "$outdir/$base.manifest"

  echo
  ls -lh "$outdir" | tail -n +2 | awk '{printf "  %6s  %s\n", $5, $9}'
  echo
  echo "==> Commit $outdir and push. Every part is under GitHub's 100MB limit."
}

cmd_join() {
  local indir="${1:?usage: chunked.sh join <indir> <output>}"
  local output="${2:?usage: chunked.sh join <indir> <output>}"

  local manifest; manifest="$(ls "$indir"/*.manifest 2>/dev/null | head -1)"
  [[ -n "$manifest" ]] || { echo "No .manifest in $indir; was it produced by 'split'?" >&2; exit 1; }

  local name expected parts
  name="$(sed -n 's/^name=//p' "$manifest")"
  expected="$(sed -n 's/^sha256=//p' "$manifest")"
  parts="$(sed -n 's/^parts=//p' "$manifest")"

  local found; found="$(ls "$indir/$name.part."* 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$found" -ne "$parts" ]]; then
    echo "!! Expected $parts parts, found $found. The push may be incomplete." >&2
    exit 1
  fi

  echo "==> Reassembling $found parts into $output"
  cat "$indir/$name.part."* > "$output"

  echo "==> Verifying checksum"
  local actual; actual="$(sum_file "$output")"
  if [[ "$actual" != "$expected" ]]; then
    echo "!! Checksum mismatch — the reassembled file is corrupt." >&2
    echo "   expected $expected" >&2
    echo "   actual   $actual" >&2
    rm -f "$output"
    exit 1
  fi

  echo "==> Verified: $output ($(du -h "$output" | cut -f1)) matches the original"
}

case "${1:-}" in
  split) shift; cmd_split "$@" ;;
  join)  shift; cmd_join "$@" ;;
  -h|--help|"") usage 0 ;;
  *) echo "Unknown command: $1" >&2; usage 1 ;;
esac
