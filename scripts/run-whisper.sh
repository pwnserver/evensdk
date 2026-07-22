#!/usr/bin/env bash
# Start a resident whisper.cpp server (model stays loaded in memory for fast,
# low-latency per-utterance transcription). Requires: brew install whisper-cpp
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL="${WHISPER_MODEL:-models/ggml-large-v3-turbo.bin}"
HOST="${WHISPER_HOST:-127.0.0.1}"
PORT="${WHISPER_PORT:-8080}"

if ! command -v whisper-server >/dev/null 2>&1; then
  echo "whisper-server not found. Install it with:  brew install whisper-cpp" >&2
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "Model not found: $MODEL" >&2
  echo "Download it with:" >&2
  echo "  curl -L -o $MODEL 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin?download=true'" >&2
  exit 1
fi

echo "Starting whisper-server on http://$HOST:$PORT  (model: $MODEL)"
exec whisper-server \
  --model "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --language auto \
  --threads "$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 8)"
