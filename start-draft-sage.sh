#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="${ROOT_DIR}"
MONOREPO_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
VENV_DIR="${API_DIR}/.venv"
REQ_FILE="${API_DIR}/requirements.txt"

UI_PORT="${DRAFT_SAGE_UI_PORT:-8000}"
API_PORT="${DRAFT_SAGE_API_PORT:-8001}"
RUN_DIR="${DRAFT_SAGE_RUN_DIR:-}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found on PATH." >&2
  exit 1
fi

if [ ! -d "${VENV_DIR}" ]; then
  echo "Creating venv at ${VENV_DIR}"
  python3 -m venv "${VENV_DIR}"
  echo "Installing requirements..."
  "${VENV_DIR}/bin/pip" install -r "${REQ_FILE}"
fi

API_CMD=("${VENV_DIR}/bin/python" "scripts/serve_api.py" "--port" "${API_PORT}")
if [ -n "${RUN_DIR}" ]; then
  API_CMD+=("--run-dir" "${RUN_DIR}")
fi

cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${UI_PID:-}" ]; then
    kill "${UI_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Draft Sage API..."
(cd "${API_DIR}" && "${API_CMD[@]}") &
API_PID=$!

echo "Starting Draft Sage UI server..."
(cd "${MONOREPO_ROOT}" && python3 -m http.server "${UI_PORT}") &
UI_PID=$!

echo "UI: http://localhost:${UI_PORT}/draft-sage/ui/index.html"
echo "API: http://localhost:${API_PORT}/health"
echo "Press Ctrl+C to stop."

wait "${API_PID}" "${UI_PID}"
