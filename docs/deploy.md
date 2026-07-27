# デプロイ手順(Firebase App Hosting)

本番は **Firebase App Hosting**(Firebase Hosting の Web フレームワーク向け製品)に上げる。
`/api/chat` と `/api/extract` はサーバー側で `GEMINI_API_KEY` を使う route handler なので、
静的ホスティングだけでは動かない。App Hosting は Cloud Run 上で Next.js をそのまま動かすため、
壁打ちのストリーミング応答もそのまま通る。

- 対象プロジェクト: `socius-career-web`
- バックエンド ID: `socius-career-web`
- リージョン: **`asia-east1`(台湾)** — App Hosting は `asia-northeast1`(東京)に未対応で、
  選べるのは `asia-east1` / `asia-southeast1` / `europe-west4` / `us-central1` / `us-east4` / `us-east5`。
  日本のユーザーには asia-east1 が最も近い。Firestore が東京にあることは効かない
  ——サーバー側は ID トークンの検証しかせず、Firestore はブラウザから直接叩いているため。
  **プライマリリージョンは作成後に変更できない**(Firestore と同じ)。

設定ファイルは 2 つ:

| ファイル | 役割 |
| --- | --- |
| `firebase.json` の `apphosting` | ローカルソースからデプロイするときの対象バックエンドと root ディレクトリ |
| `apps/web/apphosting.yaml` | Cloud Run のスケール設定と環境変数・シークレット |

アップロードされるのは**リポジトリ全体**(`.gitignore` と `ignore` を除く)だが、
ビルドされるのは `rootDir`(= `apps/web`)だけ。`apps/web/.env.local` は `.gitignore`
済みなのでアップロードされない——本番の値は `apphosting.yaml` 側で与える。

## なぜ npm workspaces をやめたのか

App Hosting は「**root ディレクトリ = アプリのディレクトリ**」を前提にしている。
ビルドパックは root ディレクトリ直下に lock ファイルを要求し、Next.js アダプタは
ビルド出力を同じ場所に探しに行く。npm workspaces のモノレポはこの前提を満たせない:

| 設定 | lock ファイル | アダプタの出力探索 |
| --- | --- | --- |
| `rootDir: apps/web`(ワークスペース時) | ❌ `fah/missing-lock-file` | ✅ |
| `rootDir: /` | ✅ | ❌ `/workspace/.next` を探すが実体は `apps/web/.next` |

回避策も一通り潰れている(記録として):

- `MONOREPO_COMMAND` / `MONOREPO_BUILD_ARGS` / `GOOGLE_BUILDABLE`
  (`@apphosting/common` のモノレポ分岐)→ 前2つは効くが、鍵になる `GOOGLE_BUILDABLE` は
  App Hosting の予約接頭辞 `GOOGLE_` のため握り潰される
- `distDir: "../../.next"` → Turbopack が拒否
  (`Invalid distDirRoot: distDirRoot should not navigate out of the projectPath`)
- ワークスペースだけ外して `packages/prompts` を残す → `apps/web` の外にあるため
  Turbopack が `@socius/prompts` を解決できない

そこで **`packages/prompts` を `apps/web/prompts` に取り込み、`apps/web` を自己完結した
単一 npm パッケージにした**。lock ファイルは `apps/web/package-lock.json` ひとつだけ。

- import 文は `@socius/prompts` のまま。`apps/web/tsconfig.json` の `paths` で
  `./prompts/index.ts` に向けている
- 生の TypeScript を読むための `transpilePackages` はもう不要なので `next.config.ts` から外した
- ルートの `package.json` はワークスペースルートではなくスクリプトランナー。
  `npm run dev` / `build` / `start` は `--prefix apps/web` に委譲する
- **依存を入れるときは `apps/web` で** `npm install`(ルートで叩いても何も入らない)

## 初回セットアップ(2026-07-27 に実施済み。再構築するとき用の記録)

### 1. Blaze(従量課金)プランへのアップグレード

App Hosting は Spark(無料)プランでは使えない。`firebaseapphosting.googleapis.com` を
有効化できないため、バックエンドの作成自体が弾かれる。

https://console.firebase.google.com/project/socius-career-web/usage/details

Blaze には無料枠が含まれていて、この規模(scale-to-zero、`maxInstances: 2`)なら
通常はほぼ課金されない。念のため同じ画面で予算アラートを設定しておく。

### 2. バックエンドの作成

```bash
firebase apphosting:backends:create \
  --project socius-career-web \
  --backend socius-career-web \
  --primary-region asia-east1 \
  --root-dir apps/web \
  -a 1:921492975909:web:aab094bc9b4cb78f4deacc \
  --non-interactive
```

`--non-interactive` を付けると GitHub 連携をスキップしてバックエンドだけを作る。
これがローカルソースからデプロイするための形。`-a` で既存の web アプリを指定しないと、
バックエンド名の新しい web アプリが勝手に作られる。

### 3. Gemini API キーを Secret Manager に入れる

```bash
cd apps/web
firebase apphosting:secrets:set GEMINI_API_KEY --project socius-career-web
```

プロンプトに `apps/web/.env.local` の `GEMINI_API_KEY` の値を貼る。
`apphosting.yaml` はこのシークレットを名前で参照していて、RUNTIME にだけ渡す。
ビルド時には渡らないので、クライアントバンドルに焼き込まれることはない。

バックエンドを先に作っておくこと。バックエンドが無い状態だと、シークレットを読む
サービスアカウントが決まらず IAM 付与がスキップされる
(あとから `firebase apphosting:secrets:grantaccess GEMINI_API_KEY --backend socius-career-web` で復旧できる)。

### 4. Firebase Auth の承認済みドメインに本番ドメインを追加

**ここを飛ばすと Google サインインが `auth/unauthorized-domain` で失敗する。**
デプロイ後に払い出される App Hosting のドメイン
(`socius-career-web--socius-career-web.<region>.hosted.app` 形式)を、
Authentication → Settings → Authorized domains に追加する。

https://console.firebase.google.com/project/socius-career-web/authentication/settings

`localhost` と Codespaces のプレビュー URL は開発用として残しておいてよい。

## 2 回目以降

```bash
firebase deploy --only apphosting --project socius-career-web
```

ローカルのソースが zip で上がり、App Hosting 側でビルドされてロールアウトされる。
Firestore のルール・インデックスを同時に反映したいときは:

```bash
firebase deploy --project socius-career-web
```

## 環境変数を足したとき

`apps/web/.env.local` に足すだけでは本番に反映されない。`apphosting.yaml` にも追記する。

- `NEXT_PUBLIC_*` = ブラウザに出て構わない値。`value:` に直書きし、`availability` は `BUILD`(と `RUNTIME`)。
  ビルド時にクライアントバンドルへ埋め込まれるので、`BUILD` が無いと `undefined` になる。
- サーバー専用の秘密 = `firebase apphosting:secrets:set <name>` で登録し、`secret:` で参照。
  `availability` は `RUNTIME` のみにする。
