#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  echo "Created backend/config.yaml from config.example.yaml"
fi

echo "Starting Brain Radiology FM Portal backend on http://127.0.0.1:${PORT} ..."
exec python3 -m uvicorn server:app --host 127.0.0.1 --port "${PORT}"
