#!/bin/bash
# cortex-auto-sync.sh — Auto-sync Cortex after each Claude Code turn (Stop hook)
CORTEX_PATH="${CORTEX_PATH:-/cortex}"
if [ -d "${CORTEX_PATH}/.git" ]; then
  cd "$CORTEX_PATH"
  git add -A 2>/dev/null
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "cortex: auto-sync $(date '+%Y-%m-%d %H:%M')" --quiet 2>/dev/null
    git push origin main --quiet 2>/dev/null
    echo "[cortex-sync] Cortex sincronizado"
  fi
fi
