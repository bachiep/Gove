#!/usr/bin/env bash
set -euo pipefail

# Read-only resource gate for local engineering work. It intentionally does
# not stop processes; the leader decides which project-owned session is idle.

mem_available_kib=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
mem_total_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
swap_total_kib=$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)
swap_free_kib=$(awk '/^SwapFree:/ { print $2 }' /proc/meminfo)
swap_used_kib=$((swap_total_kib - swap_free_kib))
root_mountpoint=${GOVE_RESOURCE_ROOT_MOUNT:-/}
root_disk_use_percent=$(df -P "$root_mountpoint" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
root_disk_available_kib=$(df -P -k "$root_mountpoint" | awk 'NR == 2 { print $4 }')

gib_kib=$((1024 * 1024))
warning_available_kib=$((mem_total_kib * 20 / 100))
critical_available_kib=$((mem_total_kib * 10 / 100))
available_gib=$(awk -v value="$mem_available_kib" -v unit="$gib_kib" 'BEGIN { printf "%.1f", value / unit }')
swap_used_gib=$(awk -v value="$swap_used_kib" -v unit="$gib_kib" 'BEGIN { printf "%.2f", value / unit }')
root_disk_available_gib=$(awk -v value="$root_disk_available_kib" -v unit="$gib_kib" 'BEGIN { printf "%.1f", value / unit }')

if (( root_disk_use_percent >= 95 )); then
  mode="stop-and-recover"
  concurrency="0"
  guidance="Root disk is critically full; do not start builds/tests/agents. Inspect project-owned resources and request cleanup approval."
elif (( mem_available_kib < critical_available_kib || swap_used_kib > 2 * gib_kib )); then
  mode="stop-and-recover"
  concurrency="0"
  guidance="Stop idle project browser/dev-server sessions; run diagnostics only."
elif (( root_disk_use_percent >= 90 || mem_available_kib < warning_available_kib || swap_used_kib > 1 * gib_kib )); then
  mode="guarded"
  concurrency="1"
  guidance="Resource pressure is elevated; avoid another heavy task and monitor root disk before starting builds/tests."
else
  mode="normal"
  concurrency="normal"
  guidance="Run normal agent work; serialize only duplicate heavy builds/tests."
fi

printf 'mode=%s\n' "$mode"
printf 'mem_available_gib=%s\n' "$available_gib"
printf 'swap_used_gib=%s\n' "$swap_used_gib"
printf 'root_disk_use_percent=%s\n' "$root_disk_use_percent"
printf 'root_disk_available_gib=%s\n' "$root_disk_available_gib"
printf 'recommended_concurrency=%s\n' "$concurrency"
printf 'guidance=%s\n' "$guidance"
