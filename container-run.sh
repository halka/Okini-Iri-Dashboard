#!/usr/bin/env bash
# container-run.sh — run Okini Iri Dashboard with Apple Container
#
# Prerequisites:
#   • Apple Silicon Mac (M1 or later)
#   • macOS 15 or later
#   • Apple Container CLI installed: brew install container
#   • Container system service running: container system start
#
# Usage:
#   ./container-run.sh          # build (if needed) and start
#   ./container-run.sh --build  # force rebuild before starting
#   ./container-run.sh stop     # stop the running container
#   ./container-run.sh logs     # tail container logs

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/.env"
  set +a
fi

IMAGE_NAME="okini-iri-dashboard"
CONTAINER_NAME="okini-iri-dashboard"
VOLUME_NAME="okini-iri-wrangler"
HOST_PORT="${PORT:-8787}"
CONTAINER_PORT="8787"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { printf '\033[1;36m[container-run]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[container-run] ERROR:\033[0m %s\n' "$*" >&2; }

require_container_cli() {
  if ! command -v container &>/dev/null; then
    err "'container' CLI not found."
    echo "  Install:  brew install container"
    echo "  Then run: container system start"
    exit 1
  fi
}

# ── Sub-commands ──────────────────────────────────────────────────────────────

cmd_stop() {
  log "Stopping container '$CONTAINER_NAME'..."
  container stop "$CONTAINER_NAME" 2>/dev/null && log "Stopped." || log "Container was not running."
  container rm "$CONTAINER_NAME" 2>/dev/null || true
}

cmd_logs() {
  log "Tailing logs for '$CONTAINER_NAME' (Ctrl-C to quit)..."
  container logs -f "$CONTAINER_NAME"
}

cmd_build() {
  log "Building image '$IMAGE_NAME' from Dockerfile..."
  container build -t "$IMAGE_NAME" .
  log "Build complete."
}

cmd_start() {
  local force_build="${1:-}"

  # Rebuild if --build flag was passed or image doesn't exist yet
  if [[ "$force_build" == "--build" ]] || ! container image inspect "$IMAGE_NAME" &>/dev/null; then
    cmd_build
  else
    log "Image '$IMAGE_NAME' already exists. Use --build to rebuild."
  fi

  # Stop any existing container with the same name
  container rm -f "$CONTAINER_NAME" 2>/dev/null || true

  log "Starting container '$CONTAINER_NAME'..."
  container run \
    --name "$CONTAINER_NAME" \
    --detach \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    -v "${VOLUME_NAME}:/app/.wrangler" \
    "$IMAGE_NAME"

  log "Dashboard is starting at http://localhost:${HOST_PORT}"
  log "Run './container-run.sh logs' to follow the startup output."
}

# ── Entry point ───────────────────────────────────────────────────────────────

require_container_cli

case "${1:-}" in
  stop)   cmd_stop ;;
  logs)   cmd_logs ;;
  --build) cmd_start "--build" ;;
  "")     cmd_start ;;
  *)
    echo "Usage: $0 [--build | stop | logs]"
    exit 1
    ;;
esac
