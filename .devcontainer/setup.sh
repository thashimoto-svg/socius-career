#!/usr/bin/env bash
# Codespaces の postCreateCommand はコンテナ作成時にしか走らない。
# 再起動のたびに消える CLI を拾い直すため、postStartCommand からも同じものを呼ぶ。
# そのため、このスクリプトは何度実行しても安全（冪等）である必要がある。
set -euo pipefail

ensure_global() {
  local bin="$1" pkg="$2"
  if command -v "$bin" >/dev/null 2>&1; then
    echo "[devcontainer] $bin は導入済み: $(command -v "$bin")"
  else
    echo "[devcontainer] $pkg を導入します ..."
    npm install -g "$pkg"
  fi
}

ensure_global claude @anthropic-ai/claude-code
ensure_global firebase firebase-tools

# 依存関係はルートではなく apps/web にある（package.json は --prefix で委譲している）
if [ ! -d apps/web/node_modules ]; then
  echo "[devcontainer] アプリの依存関係を導入します ..."
  npm install --prefix apps/web
fi

echo "[devcontainer] 準備完了"
