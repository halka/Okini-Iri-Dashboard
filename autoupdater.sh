#!/bin/bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TOTAL_STEPS=5
BAR_WIDTH=20

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  CYAN=$'\033[38;5;51m'
  PINK=$'\033[38;5;213m'
  PURPLE=$'\033[38;5;141m'
  YELLOW=$'\033[38;5;220m'
  GREEN=$'\033[38;5;84m'
  RED=$'\033[38;5;203m'
else
  RESET=""
  BOLD=""
  CYAN=""
  PINK=""
  PURPLE=""
  YELLOW=""
  GREEN=""
  RED=""
fi

progress() {
  local current="$1"
  local label="$2"
  local filled=$((current * BAR_WIDTH / TOTAL_STEPS))
  local empty=$((BAR_WIDTH - filled))
  local bar=""
  local i
  local color="$CYAN"

  case "$current" in
    2) color="$PURPLE" ;;
    3) color="$PINK" ;;
    4) color="$YELLOW" ;;
    5) color="$GREEN" ;;
  esac

  for ((i = 0; i < filled; i++)); do bar+="█"; done
  for ((i = 0; i < empty; i++)); do bar+="░"; done

  printf '\n%s✦  [%s%s%s] %d/%d  %s%s%s\n' \
    "$color" "$BOLD" "$bar" "$RESET$color" \
    "$current" "$TOTAL_STEPS" "$BOLD" "$label" "$RESET"
}

sparkle() {
  printf '%s%s✨ %s ✨%s\n' "$PINK" "$BOLD" "$*" "$RESET"
}

printf '\n%s%s╭──────────────────────────────────────────╮%s\n' "$PURPLE" "$BOLD" "$RESET"
printf '%s%s│   ✨  Okini Iri Dashboard Updater  ✨    │%s\n' "$PURPLE" "$BOLD" "$RESET"
printf '%s%s╰──────────────────────────────────────────╯%s\n' "$PURPLE" "$BOLD" "$RESET"
printf '%s💾 Your D1 / KV data volume will be preserved%s\n' "$GREEN" "$RESET"

progress 1 "Pulling the latest code"
git pull

# Recreate the Compose service from a clean image while retaining the named
# wrangler_data volume that contains the local D1 and KV state.
progress 2 "Removing old containers, networks, and local images"
sudo docker compose down --remove-orphans --rmi local

progress 3 "Building and starting the updated image"
sudo docker compose up --build -d --remove-orphans

progress 4 "Checking container logs"
printf '%s%sAfter confirming there are no errors, press Ctrl-C to continue.%s\n\n' "$YELLOW" "$BOLD" "$RESET"
logs_interrupted=0
trap 'logs_interrupted=1' INT
set +e
sudo docker compose logs --follow
logs_status=$?
set -e
trap - INT

if (( logs_status != 0 && logs_status != 130 && logs_interrupted == 0 )); then
  printf '%s[update] docker compose logs failed with status %d.%s\n' "$RED" "$logs_status" "$RESET" >&2
  exit "$logs_status"
fi

progress 5 "Cleaning up unused Docker resources"
sudo docker system prune -af

printf '\n'
sparkle "Update complete!"
printf '%s%sEverything is up to date, and your data is safe.%s\n\n' "$GREEN" "$BOLD" "$RESET"
