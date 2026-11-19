#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks 未安装。macOS: brew install gitleaks；CI 使用 gitleaks-action。" >&2
  exit 1
fi

# 全历史扫描；--redact 避免命中内容出现在 CI/本地日志里。
gitleaks detect --source . --redact --log-opts="--all"
