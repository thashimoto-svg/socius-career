# デプロイ手順(Firebase App Hosting)

本番は **Firebase App Hosting**(Firebase Hosting の Web フレームワーク向け製品)に上げる。
`/api/chat` と `/api/extract` はサーバー側で `ANTHROPIC_API_KEY` を使う route handler なので、
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

### 3. API キーを Secret Manager に入れる

```bash
cd apps/web
firebase apphosting:secrets:set ANTHROPIC_API_KEY --project socius-career-web
```

プロンプトに `apps/web/.env.local` の `ANTHROPIC_API_KEY` の値を貼る。
`apphosting.yaml` はこのシークレットを名前で参照していて、RUNTIME にだけ渡す。
ビルド時には渡らないので、クライアントバンドルに焼き込まれることはない。

バックエンドを先に作っておくこと。バックエンドが無い状態だと、シークレットを読む
サービスアカウントが決まらず IAM 付与がスキップされる
(あとから `firebase apphosting:secrets:grantaccess ANTHROPIC_API_KEY --backend socius-career-web` で復旧できる)。

`GEMINI_API_KEY` は切り戻し用に登録したままにしてある。`apphosting.yaml` からも
参照は残っているが、どのルートも読んでいない。

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

## モデルの選択

どのモデルが答えるかは `CHAT_MODEL`(未設定なら `claude-sonnet-4-6`)で決まる。
抽出だけ別のモデルにしたいときは `EXTRACT_MODEL`。どちらも `apphosting.yaml` の
`value:` に直書きでよい——秘密ではないので Secret Manager には入れない。

ルートは `temperature` も `thinking` も送っていない。どちらもモデルによって
受け付ける値が違い(`temperature` は Opus 4.7 以降で 400 になる)、送ると
`CHAT_MODEL` が嘘になるため。どのモデルを入れても通る形にしてある。

## 日次上限

`DAILY_MESSAGE_LIMIT`(未設定なら 50)。学生1人あたり1日に送れるメッセージ数で、
判定はサーバー側(`app/api/chat`)、カウントは `users/{uid}/usage/{YYYY-MM-DD}`。
日付は **日本時間** で切る——「明日また続けましょう」が朝9時リセットを意味しては困る。

ルートは firebase-admin を持たない。カウンタは **学生自身の ID トークン**で
Firestore REST API を叩いて読み書きする。サービスアカウントを置けば、50 を数えるために
全学生のドキュメントツリーへの権限をサーバーに与えることになるため。
安全性は `firestore.rules` 側で担保している:

- `create` は `count` が 0 か 1 のときだけ
- `update` は `count == 既存 + 1` のときだけ(トークンには触れないこと)
- `delete` は誰にもできない

つまり学生は自分の枠を早く使い切ることはできるが、**戻すことはできない**。
守る価値があるのはそちらだけ。

## トークン使用量(コスト集計用)

同じ `users/{uid}/usage/{YYYY-MM-DD}` に、その日のトークンも溜まる:

| フィールド | 中身 | 単価(list, Sonnet 4.x) |
| --- | --- | --- |
| `inputTokens` | キャッシュに当たらなかった入力 | ×1.0 |
| `outputTokens` | 出力 | ×5.0 |
| `cacheWriteTokens` | キャッシュに書いた分 | ×1.25 |
| `cacheReadTokens` | キャッシュから読んだ分 | ×0.1 |

`count` とは**別の書き込み**で入る。上限は turn の前に判定できるので PATCH できるが、
トークンはモデルが終わるまで分からず、壁打ちの返答と裏の抽出が同時に終わることも
あるため、`:commit` の `increment` transform で原子的に足している。
ルール側も分けてあり、**count を動かす書き込みはトークンに触れない / トークンを足す
書き込みは count に触れない**。減算はどちらもできない。

`cacheReadTokens` がずっと 0 なら、キャッシュのブレークポイントが黙って壊れている
合図。プロンプトを短くすると最小キャッシュ長(1024 トークン)を割って、エラーも
出ないまま効かなくなることがある。`apps/web/scripts/measure-cache-prefix.mjs` で測れる。

> ⚠️ **ルールとアプリは同時に出すこと。** アプリだけ先に出すとトークン書き込みが
> 403 で落ちる(ログに出るだけで会話は壊れない)。`firebase deploy --project …`
> をルール込みで打つか、`--only apphosting,firestore` を指定する。

カウンタが読めなかったときは**通す**。上限はコストの上限であって、
カウンタが落ちている間だけ学生に話しかけないでおく理由にはならない。

検証:

```bash
cd apps/web
npm run check:claude          # 枠を消費しない。分類・リトライ・履歴変換・日付境界の検査
npm run check:extraction      # 重複判定のしきい値
```

## Gemini の利用枠 — ここが実機テストを止めた(移行前の記録)

以下は Claude に移行する理由になった事象の記録。`lib/server/gemini.ts` を
戻すときはここを読み直すこと。

`GEMINI_API_KEY` が無料枠のキーだと、`gemini-2.5-flash` に対する上限は
**プロジェクトあたり 1 日 20 リクエスト / 1 分 5 リクエスト**しかない
(2026-07 時点。実測値。`quotaId` は `GenerateRequestsPerDayPerProjectPerModel-FreeTier`)。

壁打ちは **AI の初回発話で 1 回 + 1 往復ごとに 1 回**、エピソード抽出でさらに 1 回
使う。つまり **16 往復でちょうど 17 リクエスト**、そこに再送や別セッションが数回
乗れば日次上限に届く。上限は日付が変わるまでリセットされないので、その日は
チャットも抽出も両方止まる。これが Miyuu の実機テストで出た
「16ラリー前後で『AIの応答に失敗しました』、以降は抽出もできない」の正体。

上限は**プロジェクト単位で、ユーザー単位ではない**。学生が 2 人同時に使えば
半分の往復で尽きる。**複数人でのテストや本番運用の前に、キーを課金プロジェクトの
ものに切り替えること。**

- 枠の確認: https://ai.dev/rate-limit
- 課金の設定: https://aistudio.google.com/apikey から該当プロジェクトに billing を紐付ける

アプリ側の備え(`apps/web/lib/server/gemini.ts`):

- 429 は `quotaId` を読んで**日次上限と分次上限を区別**する。日次はリトライしても
  直らないので即返し、翌日まで待つことを伝える。分次と 5xx は指数バックオフで
  最大 2 回リトライする
- リトライの合計待ち時間には上限がある。API が「35 秒待て」と言ってきたときに
  スピナーを回し続けるより、正確なメッセージを返して再送させるほうがよい
- 失敗しても会話は続行可能。学生の発言は保存済みなので、`再送する` で応答だけを
  取り直せる

検証:

```bash
cd apps/web
npm run check:gemini          # 枠を消費しない。ウィンドウ・分類・リトライの検査
npm run simulate:chat 22      # 実際に 22 往復 + 抽出を回す。24 リクエスト必要
```
