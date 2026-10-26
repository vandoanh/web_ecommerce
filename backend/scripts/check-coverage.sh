#!/bin/sh
set -eu

profile="${1:-coverage.out}"
minimum="${MIN_COVERAGE:-20}"
report="$(go tool cover -func="$profile")"
printf '%s\n' "$report"

total="$(printf '%s\n' "$report" | awk '/^total:/ { gsub(/%/, "", $3); print $3 }')"
if [ -z "$total" ]; then
  echo "Could not read total coverage from $profile" >&2
  exit 1
fi

awk -v total="$total" -v minimum="$minimum" 'BEGIN {
  if (total + 0 < minimum + 0) {
    printf "Coverage %.1f%% is below the %.1f%% minimum.\n", total, minimum
    exit 1
  }
  printf "Coverage %.1f%% meets the %.1f%% minimum.\n", total, minimum
}'
