#!/usr/bin/env bash
# Entrypoint for the IOPaint dev container.
# All settings are driven by environment variables so docker-compose.yml (or a
# .env file) is the single place to change them — no Dockerfile edits needed.
set -e

echo "Starting IOPaint..."
echo "  Device           : ${DEVICE:-cuda}"
echo "  Model            : ${MODEL:-lama}"
echo "  Port             : ${PORT:-8088}"
echo "  Model dir        : ${MODEL_DIR:-/models}"
echo "  Interactive seg  : enabled (${INTERACTIVE_SEG_MODEL:-sam2_1_tiny} on ${INTERACTIVE_SEG_DEVICE:-cuda})"
echo "  Remove background: ${ENABLE_REMOVE_BG:-true} (${REMOVE_BG_MODEL:-egeorcun/lucida} on ${REMOVE_BG_DEVICE:-cuda})"

remove_bg_args=()
if [ "${ENABLE_REMOVE_BG:-true}" = "true" ]; then
    remove_bg_args=(--enable-remove-bg --remove-bg-model "${REMOVE_BG_MODEL:-egeorcun/lucida}" --remove-bg-device "${REMOVE_BG_DEVICE:-cuda}")
fi

exec iopaint start \
    --host    0.0.0.0 \
    --port    "${PORT:-8088}" \
    --device  "${DEVICE:-cuda}" \
    --model   "${MODEL:-lama}" \
    --model-dir "${MODEL_DIR:-/models}" \
    --enable-interactive-seg \
    --interactive-seg-model  "${INTERACTIVE_SEG_MODEL:-sam2_1_tiny}" \
    --interactive-seg-device "${INTERACTIVE_SEG_DEVICE:-cuda}" \
    "${remove_bg_args[@]}"
