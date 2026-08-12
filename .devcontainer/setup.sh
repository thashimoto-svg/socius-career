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

# gcloud は npm では入らない。Codespaces の universal イメージにも入っていない
# ので、手で入れたぶんは Codespace を作り直した時点で消える（2026-08-12 に
# Workload Identity 連携を組むとき、まさにそれを手で入れていた）。
#
# apt を使うのは、公式が配布している形がこれだから。tarball を $HOME に置く手も
# あるが、PATH を通す仕掛けを別に用意することになるうえ、gcloud 自身の
# `components update` と apt の更新経路が二重になる。
#
# 入っていれば触らないので、再起動のたびに apt が走ることはない。
ensure_gcloud() {
  if command -v gcloud >/dev/null 2>&1; then
    echo "[devcontainer] gcloud は導入済み: $(gcloud --version | head -1)"
    return
  fi

  echo "[devcontainer] Google Cloud CLI を導入します ..."

  # 鍵とリポジトリ定義も /usr 以下なので、CLI と一緒に消えている。毎回置き直す。
  sudo install -m 0755 -d /usr/share/keyrings
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/cloud.google.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list >/dev/null

  # このリポジトリだけを見に行く。universal イメージが抱えている他のソースまで
  # 更新すると、gcloud を入れるためだけに数分待つことになる。
  sudo apt-get update -qq \
    -o Dir::Etc::sourcelist=sources.list.d/google-cloud-sdk.list \
    -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0
  sudo apt-get install -y -qq google-cloud-cli
}

ensure_gcloud

# ログイン状態そのものは ~/.config/gcloud にあり、$HOME は再起動をまたいで
# 残る。CLI さえ戻れば認証はやり直さなくていい——ただし Codespace を作り直した
# ときは消えるので、そのときは `gcloud auth login` から。

# 依存関係はルートではなく apps/web にある（package.json は --prefix で委譲している）
if [ ! -d apps/web/node_modules ]; then
  echo "[devcontainer] アプリの依存関係を導入します ..."
  npm install --prefix apps/web
fi

echo "[devcontainer] 準備完了"
