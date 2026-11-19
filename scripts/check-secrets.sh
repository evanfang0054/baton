#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks 未安装。macOS: brew install gitleaks；CI 使用固定版本的 gitleaks CLI。" >&2
  exit 1
fi

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "当前仓库是 shallow clone，无法扫描全历史；请先 git fetch --unshallow。" >&2
  exit 1
fi

# 全历史扫描；--redact 避免命中内容出现在 CI/本地日志里。
gitleaks git --redact --log-opts="--all"
