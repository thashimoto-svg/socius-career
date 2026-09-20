# Llama 自社開発 調査レポート

2026-08-30 時点(§0 の承認と §9 の詳細化は 2026-09-20)。
RTX 3060 / VRAM 12GB / CUDA 13.3 の Windows 機を開発環境とし、
50人規模のβを 自宅GPUホスト で賄えるかを検証するための調査。

**現行の Claude API 実装(`lib/server/anthropic.ts` / `app/api/chat/route.ts`)には
一切手を入れていない。** 本文は設計案と数値であって、本番経路の変更ではない。
9/20 に足したのは計測用の台本だけで、`apps/web/scripts/` に閉じている(§9.1)。

## この文書の読み方 — 数字の出どころ

数字は三種類ある。混ぜて読むと判断を誤るので、記号で分けてある。

| 記号 | 意味 |
| --- | --- |
| **[実測]** | このリポジトリのコードを実際に走らせて数えた値 |
| **[出典]** | 一次情報・公式ドキュメント・公開ベンチマーク(末尾に参照) |
| **[推定]** | 上の二つから計算した見積もり。**PoC で置き換えるべき仮の数字** |

特に**トークン数と生成速度は全て [推定]**。Llama 3.1 系のトークナイザは日本語を
Claude より細かく割るが、その比率は実測しないと分からない。PoC(項目9)の
第一の目的はここを実測に置き換えることにある。

---

## 0. 先に結論 — 承認済みの2点

### 項目1(実行スタック)の結論

> **PoC は Ollama(Windowsネイティブ)、β本番は llama.cpp の `llama-server`
> (Windowsネイティブ CUDA ビルド)。WSL2+vLLM は RTX 3060 では採らない。**

**2026-09-20 承認。** ご提示の二択(WSL2+vLLM vs Ollama)で言えば **Ollama の勝ち**。ただし
「同時接続を捌く」という要件だけは Ollama が構造的に弱いので、同じ llama.cpp
ファミリーで真の継続バッチングを持つ `llama-server` を β本番の推奨としている。
根拠は §1。

### 項目2(モデル)の結論

> **Llama 3.1 Swallow 8B Instruct v0.5 / GGUF Q4_K_M(4.92GB)を第一候補。
> Llama-3-ELYZA-JP-8B は PoC での比較対象(対抗馬)であって、本命ではない。**

**2026-09-20 承認。** 日本語品質・更新の新しさ・GGUF の入手性のすべてで Swallow v0.5 が上。ELYZA の
8B は Llama **3**(2024年6月)ベースで世代が古く、ELYZA の Llama 3.1 系は 70B の
企業向け提供しか公開されていない。根拠は §2。

### 併せて申し上げておきたいこと(反対ではなく、判断材料として)

**50人βの規模では、コスト削減は移行の理由になりません。** §6 の試算で
Claude 現状が月 **約1.7万円**、自宅GPU が月 **約1,900円**(電気代のみ)。差は
月1.5万円で、これは実装・運用に投じる工数の対価としては小さい。

したがって Llama 自社開発の投資判断は「安いから」ではなく、

- **単価の天井が無くなる**(1,000人規模になったとき初めて効く)
- **会話ログを外に出さずに学習に使える**(§7 の FT はこれが無いと成立しない)
- **自社でモデルを持つこと自体が事業上の資産**

のどれかであるべきです。方針はすでに決まっているものとして、以下は
「決めた前提でどう作るのが正しいか」に集中しています。

---

## 1. ローカル実行スタック(Windows)

### 1.1 三択の比較

要件は4つ。**アプリから叩ける OpenAI互換API**、**SSEストリーミング**、
**継続バッチング**、そして暗黙の第5要件として **RTX 3060 12GB に載ること**。

| | WSL2 + vLLM | Ollama(ネイティブ) | llama.cpp `llama-server`(ネイティブ) |
| --- | --- | --- | --- |
| OpenAI互換API | ◎ `/v1/chat/completions` 完備 | ○ `/v1` にあり [出典] | ○ `/v1/chat/completions` あり |
| SSEストリーミング | ◎ | ○(クライアント側の `[DONE]` 解釈にバグ報告あり [出典]) | ◎ |
| 継続バッチング | ◎ PagedAttention + 連続バッチ | **△ 構造的に弱い**(後述) | ○ **既定で有効**、`--parallel N` [出典] |
| 12GB に 8B が載るか | **× 実質No**(後述) | ◎ Q4_K_M 4.92GB | ◎ 同左 |
| Windows での導入 | △ WSL2必須。公式に Windows ネイティブ非対応 [出典] | ◎ インストーラ一発 | ○ CUDA 済みビルドを解凍するだけ |
| プレフィックス再利用 | ◎ Automatic Prefix Caching | △ 実装依存 | ◎ スロット単位のプロンプトキャッシュ |
| 運用の手数 | 多い | 最小 | 中 |

### 1.2 なぜ WSL2+vLLM を採らないのか — 12GB という壁

vLLM を 3060 で使えない理由は、性能ではなく **重みの形式** にある。

- **BF16 の 8B は 16GB。12GB には載らない。** vLLM の実用最低ラインは
  「7B/8B を BF16 で 12GB」とされるが [出典]、これは KV キャッシュをほぼ
  取らない場合の話で、16K 前後の文脈を張ると即座に溢れる。
- **なので 4bit 量子化が必須になるが、Swallow 8B v0.5 の公式 AWQ/GPTQ は
  存在しない。** Swallow チームが AWQ-INT4 を公式配布しているのは
  **Qwen3-Swallow**(Qwen ベース、2026年)であって、Llama 3.1 Swallow ではない [出典]。
  自分で AWQ 量子化する(キャリブレーション用データと GPU 時間が要る)か、
- **vLLM の GGUF 対応に頼ることになるが、これは “highly experimental and
  under-optimized”、かつ本体から外れて OOT プラグイン(`vllm-gguf-plugin`)に
  移行済み** [出典]。継続バッチングのために vLLM を選んだのに、その継続バッチングが
  効くか分からない経路を通ることになる。本末転倒。

vLLM が正解になるのは **16GB 以上のカードに更新したとき**、または
**Qwen3-Swallow-8B-RL-v0.2-AWQ-INT4 に乗り換えるとき**。後者は公式 AWQ があり
vLLM が推奨実行系なので構成としては綺麗だが、**Llama ではない**(§8 参照)。
方針が「Llama 自社開発」である以上、今回は対象外とした。

### 1.3 なぜ Ollama だけでは β を越えられないのか

Ollama は llama.cpp を内蔵しているが、並列処理は `OLLAMA_NUM_PARALLEL` で
「推論コンテキストを複数同時に走らせる」だけで、真の継続バッチングの
メモリ管理機構を持たない。VRAM 圧だけが増えてスループットは伸びない [出典]。
2026年の複数の独立ベンチで、8同時接続時に vLLM 比 2.2〜4倍のスループット差、
10同時接続で応答が 2秒 → 45秒 に劣化するという報告がある [出典]。

一方 **`llama-server` は継続バッチングが既定で有効**で、`--parallel N` で
スロットを切り、スロットごとに KV キャッシュと生成状態を持つ。空いたスロットに
即座に次のプロンプトを差し込む [出典]。Ollama に無いのはここ。

**同じ GGUF ファイルがそのまま動く**ので、Ollama → `llama-server` の移行は
モデルの入れ替えを伴わない。だから PoC は Ollama で速く回し、βの前に
`llama-server` へ差し替える、という二段構えが最も無駄がない。

### 1.4 セットアップ手順の概要

#### (A) PoC 用 — Ollama、所要 15分

```powershell
# 1. https://ollama.com/download/windows からインストーラを実行
# 2. Swallow v0.5 の Q4_K_M(日本語 imatrix キャリブレーション済み)を取得
ollama pull okamototk/llama-swallow:8b

# 3. 疎通確認(OpenAI 互換エンドポイント + SSE)
curl http://localhost:11434/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "okamototk/llama-swallow:8b",
  "messages": [{"role":"user","content":"こんにちは"}],
  "stream": true
}'
```

環境変数(システム環境変数に設定して Ollama を再起動):

| 変数 | 値 | 理由 |
| --- | --- | --- |
| `OLLAMA_NUM_PARALLEL` | `2` | 3060 では 2 が現実的な上限(§3) |
| `OLLAMA_KEEP_ALIVE` | `-1` | モデルを VRAM に常駐。毎回のロード(数十秒)を避ける |
| `OLLAMA_FLASH_ATTENTION` | `1` | KV キャッシュ量子化の前提 |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | KV を半分に(§3) |

#### (B) β本番 — `llama-server`

```powershell
# 1. github.com/ggml-org/llama.cpp の Releases から
#    llama-<version>-bin-win-cuda-x64.zip を解凍(ビルド不要)
# 2. GGUF を取得(Hugging Face: mmnga/Llama-3.1-Swallow-8B-Instruct-v0.5-gguf 等)
# 3. 起動
.\llama-server.exe `
  --model .\Llama-3.1-Swallow-8B-Instruct-v0.5-Q4_K_M.gguf `
  --n-gpu-layers 99 `
  --ctx-size 24576 `           # 全スロット合計。1スロットあたり 24576/2 = 12288
  --parallel 2 `               # スロット数(§3 で導出)
  --cache-type-k q8_0 --cache-type-v q8_0 `
  --flash-attn `
  --cont-batching `            # 既定で有効だが明示する
  --slot-save-path .\slots `   # スロットKVの退避先。会話の継続に効く
  --host 127.0.0.1 --port 8080 `
  --api-key <ローカル用の適当な鍵>
```

`--host 127.0.0.1` は意図的。**外に出す口は Cloudflare Tunnel 側にだけ持たせ、
llama-server 自身は LAN にすら公開しない**(§4)。

---

## 2. モデル選定

### 2.1 候補と評価

| | Llama 3.1 Swallow 8B Instruct **v0.5** | Llama-3-ELYZA-JP-8B | (参考)Qwen3-Swallow-8B RL v0.2 |
| --- | --- | --- | --- |
| ベース | Llama 3.1 8B | Llama **3** 8B | Qwen3 8B — **Llama ではない** |
| 公開 | 2025年6月 [出典] | 2024年6月 [出典] | 2026年 [出典] |
| 日本語総合 | **0.543**(10B以下のオープンLLMで3位)[出典] | 世代が古く同一土俵の数字なし | Swallow系の最新 |
| 日本語MT-Bench | **JMTAvg 0.719**(v0.3比 +1.5pt)[出典] | — | — |
| GGUF Q4_K_M | **4.92GB**、複数配布元 [出典] | 公式配布あり(elyza/…-GGUF)[出典] | 公式は AWQ-INT4(vLLM向け) |
| Ollama 即利用 | ◎ `okamototk/llama-swallow:8b` [出典] | ◎ | △ |
| ライセンス | Llama 3.1 Community + **Gemma利用規約** [出典] | Llama 3 Community | Qwen 系(Llama とは別体系) |

**Swallow v0.5 を推す理由**は3つ。

1. **日本語生成の実力が現時点で最上位のLlama派生8B。** 総合 0.543 で 10B以下
   オープンLLM中3位。上位2つ(Gemma-2-Llama Swallow 9B = 0.558、Qwen3-8B-Base
   = 0.551)は「Llama 3.1 派生」ではないので、方針の枠内では実質1位 [出典]。
2. **壁打ちに効く軸が特に強い。** 日本語MT-Bench の内訳で **roleplay 0.796 /
   writing 0.832**。今回の用途(共感的な受け止め + 一問だけの深掘り)は
   まさに roleplay と writing の合成で、知識問題やコード生成ではない [出典]。
3. **手に入る形が整っている。** 日本語 imatrix でキャリブレーションされた
   Q4_K_M が Ollama から1コマンドで引ける [出典]。ELYZA も GGUF はあるが、
   ベースが Llama 3 世代で、ELYZA の 3.1 系は 70B の企業向け提供しか
   公開されていない [出典] ため 8B の後継が無い。

### 2.2 VRAM・速度の目安(RTX 3060 12GB)

| 項目 | 値 | 種別 |
| --- | --- | --- |
| Q4_K_M 重み | **4.92 GB** | [出典] |
| CUDAコンテキスト + 計算バッファ | 約 0.8 GB | [推定] |
| Windows デスクトップが同じGPUに乗る場合 | 追加 0.5〜1.0 GB | [推定] |
| **KV キャッシュに使える残り** | **約 4.8〜5.8 GB** | [推定] |
| 単発生成速度(8B Q4_K_M) | **45〜55 tok/s**(同クラス8Bの実測値から)| [出典/推定] |
| プレフィル速度 | 700〜1,200 tok/s | [推定] |

### 2.3 壁打ち用途への向き・不向き — ここが本当の争点

**日本語の流暢さは問題にならない。落ちるとしたら「指示の遵守」で落ちる。**

現行のシステムプロンプトは **[実測] 5,069文字**(`buildChatSystemBlocks()` を
実際に組んで数えた)で、中身は

- 絶対に守るルール **9項目**(抽象語の具体化 / 結論を先に出さない /
  **問いはひとつだけ** / 要約しない / 250字以内 / 深掘りの三段 / Markdown禁止 …)
- トーン層(じっくり / ストレート。禁止表現の列挙を含む)
- オンボーディング注入部
- **エピソードシート protocol** — 本文の後に `[sheet]` ブロックを
  **毎ターン必ず** 決まった書式で出力させる

8B クラスが崩れるのは、この **「長い制約リストを全部同時に守り続ける」** 部分。
具体的に想定される失敗は4つ:

| 失敗モード | 影響 | PoC での検出方法 |
| --- | --- | --- |
| **`[sheet]` ブロックを出さない / 書式が崩れる** | **記憶が消える。** シートは16往復の窓から溢れた話を保持する唯一の仕組み(`transcript.ts` 参照)。ここが壊れると 8/18 のβ報告「最初の話を忘れている」が再発する | `parseWorksheet()` が null を返す率を数える |
| **問いを2つ以上並べる** | 深掘りが浅くなる(コア原則3の違反) | 返答末尾の「?」の数 |
| **250字を超える / 箇条書きが出る** | 吹き出しのUIが崩れる | 文字数と `^[-・*]` の検出 |
| **結論・要約・評価を先に出す** | 「AIが答えを出す場ではない」という製品の前提が崩れる | 人手評価(§9) |

**この4つは全て機械的に測れる。**しかも `parseWorksheet` / `parseChoices` /
`stripTags` という判定器がすでにリポジトリにある(`prompts/reply.ts`)。
PoC の品質比較は感想文ではなく、**この4指標の Claude 対 Swallow の数値比較**
として設計すべき。

そして重要なのは、**ここが崩れるなら §7 のファインチューニングは
「あると良いもの」ではなく「必須」になる**ということ。プロンプトで守れない
書式は、学習で内在化させるしかない。

---

## 3. 同時接続の見積もり — 12GB の KV キャッシュ設計

> §1・§2 の結論(llama-server + Swallow 8B Q4_K_M)を前提とする。

### 3.1 KV キャッシュの計算式(アーキテクチャから決まる)

Llama 3.1 8B は 32層 / KVヘッド8 / head_dim 128(GQA)。

```
1トークンあたり = 2(K,V) × 32層 × 8ヘッド × 128 × 2バイト(fp16)
                = 131,072 バイト = 128 KiB / token
```

| KV精度 | 1トークンあたり | 備考 |
| --- | --- | --- |
| fp16 | 128 KiB | 既定 |
| **q8_0** | **64 KiB** | 品質劣化はほぼ無し。**推奨** |
| q4_0 | 32 KiB | 長文脈で劣化が見える。非常用 |

### 3.2 1リクエストが必要とする文脈長 [推定]

現行アプリが1ターンで送る中身:

| 部品 | 文字数 | 根拠 |
| --- | --- | --- |
| システムプロンプト2ブロック | **5,069** | [実測] |
| 履歴 16往復 | 約 5,600 | `scripts/` の台本が1往復 約350字 [実測] |
| エピソードシート(末尾同封) | 400〜800 | 埋まるにつれ増える [推定] |
| **合計(窓が満杯のとき)** | **約 11,300** | |

Llama 3.1 のトークナイザは日本語で **1トークン ≒ 1.0〜1.3文字** [推定]。
Claude 側は 1トークン ≒ 2文字(`transcript.ts` のコメント記載)なので、
**同じ会話がローカルではおよそ 1.5〜2倍のトークン数になる**。

> ここは Swallow でも改善しない。Swallow チームは Llama 3 系では
> **語彙拡張をあえて行っていない**(48,000サブワード追加の予備実験で系列長
> 20%短縮に留まり、Llama 2 の 42%短縮に比べて効果が薄く、タスク性能劣化と
> モデルマージの困難さを嫌った)[出典]。つまり日本語のトークン効率は
> 素の Llama 3.1 と同じ。

出力(返答250字 + sheetブロック)を 640トークンとして、
**1スロットあたり `n_ctx = 12,288`(12K)** を設計値とする。

### 3.3 同時2 / 4 / 8ストリームの挙動予測 [推定]

KV 予算を **5.3 GB** としたとき:

| 同時数 | KV=fp16 | KV=q8_0 | 判定 |
| --- | --- | --- | --- |
| **2** | 3.0 GB | 1.5 GB | **◎ 余裕。fp16 のままで可** |
| **4** | 6.0 GB | **3.0 GB** | **○ q8_0 なら収まる** |
| **8** | 12.0 GB ✗ | 6.0 GB ✗ | **× q4_0 か文脈短縮が必要** |

スループット面(3060 は帯域律速、360GB/s):

| 同時数 | 合計スループット | 1ストリームあたり | 体感 |
| --- | --- | --- | --- |
| 1 | 45〜55 tok/s | 45〜55 | 250字の返答が **約4〜6秒** |
| 2 | 70〜90 tok/s | 35〜45 | ほぼ劣化なし |
| 4 | 100〜140 tok/s | 25〜35 | 許容範囲 |
| 8 | 150〜200 tok/s | 20〜25 | 生成は耐えるが **TTFT が壊れる**(下記) |

### 3.4 本当のボトルネックは生成速度ではなく TTFT — 窓が滑った瞬間に来る

**これが今回の調査で一番重要な発見です。**

`llama-server` はスロットごとにプロンプトキャッシュを持ち、**前方一致した分の
プレフィルを丸ごと省略する**。これは Anthropic のプロンプトキャッシュと
同じ「プレフィックス一致」の仕組み。

そして現行アプリは、**その一致が保たれる条件をすでにコード上で知っている。**
`transcript.ts` の `HistoryWindow.complete` がそれで、
「窓がまだ会話全体を保持しているか」を表す。

| 状態 | ローカルでの再プレフィル量 | TTFT [推定] |
| --- | --- | --- |
| **`complete === true`**(16往復以内) | 新しいユーザー発話 + シート ≒ 800トークン | **約1秒** |
| **`complete === false`**(17往復目以降) | **文脈全体 ≒ 10,000トークン** | **約10〜14秒** |

窓が滑り始めた瞬間、先頭の1往復が落ちて以降の全バイトがずれ、キャッシュは
二度と読まれない。**17往復目から毎ターン10秒超の待ち時間が発生する。**
Claude 側でも同じ理由で `complete === false` のときブレークポイントを外している
(外さないと1.25倍の書き込み料を払い続けるため)。同じ性質が、
ローカルでは**課金ではなく待ち時間**として現れる。

しかも β報告「同じことを二度聞かれる」を受けて窓を6→16に広げた経緯があるので、
**20往復の会話は現に起きる**(`scripts/verify-long-memory.mjs` が20往復を回している)。

対策の選択肢:

1. **`--slot-save-path` + スロット固定**。会話とスロットを1対1で貼り付け、
   KVを退避・復元する。ただしスロット数 = 同時会話数の上限になる。
2. **窓が滑る前に会話を締める**設計に寄せる(シートがあるので成立はする)。
3. **§7 の FT でシステムプロンプトを短縮する。**5,069文字の指示を学習で
   内在化できれば、プレフィル量そのものが半分以下になる。**これが本命。**

### 3.5 負荷テストの設計 — 既存の検証台本を並列で流す

新しい台本を書く必要はない。**すでに2本ある。**

| 台本 | 内容 | 転用先 |
| --- | --- | --- |
| `scripts/simulate-long-conversation.mjs` | 25発話の学生役(サッカー部) | ストリームA |
| `scripts/measure-session-cost.mjs` | 20発話の学生役(居酒屋バイト) | ストリームB |
| `scripts/verify-long-memory.mjs` | 20往復 + 序盤の事実3件を聞き返す | **窓が滑った後のTTFT測定に最適** |

設計:

```
負荷テスト = N本のワーカーを同時起動
  各ワーカー: 台本を1発話ずつ投入 → 完了を待つ → 次の発話(人間と同じ直列)
  ワーカー間の開始時刻を 0〜30秒でずらす(同時プレフィルの同期を崩す)
  N = 2, 4, 8 の3回
```

**各ターンで記録する値**(これが成果物):

| 指標 | 取り方 |
| --- | --- |
| TTFT | 送信 → 最初のSSEチャンク到達 |
| 生成 tok/s | `usage.completion_tokens` / (完了 - 初トークン) |
| **`complete` フラグ** | `historyWindowWithState()` の戻り値。TTFT と突き合わせる |
| プレフィルキャッシュヒット | `llama-server` の `timings.prompt_n` / `cache_n` |
| VRAM 使用量 | `nvidia-smi --query-gpu=memory.used --format=csv -l 1` |
| **書式遵守4指標** | §2.3 の表。`parseWorksheet` 等をそのまま使う |

**合否ライン(提案)**: 同時4で **TTFT p95 < 3秒(窓が滑る前)**、
**`[sheet]` 欠落率 < 5%**、**VRAM 余裕 > 1GB**。

---

## 4. 本番接続経路 — 自宅PCを公開せずに Firebase App Hosting から叩く

### 4.1 選択肢

| | Cloudflare Tunnel | Tailscale Funnel | ngrok 有料 | VPS 経由 SSH リバース |
| --- | --- | --- | --- | --- |
| 自宅の受信ポート開放 | **不要**(cloudflared が外向きに張る)[出典] | 不要 | 不要 | 不要 |
| 固定ドメイン | ◎ 自ドメイン | ○ `*.ts.net` | ○ | ◎ |
| 認証を手前に置ける | ◎ Cloudflare Access / mTLS | ○ | △ | 自前 |
| SSE のバッファリング | 要確認(下記) | ○ | ○ | 要設定 |
| 費用 | **無料枠で足りる** | 無料枠あり | 有料 | VPS代 |
| 追加レイテンシ | **10〜40ms**(最寄りPoP依存)[出典] | 20〜50ms | 30〜80ms | VPS所在地依存 |

**推奨: Cloudflare Tunnel。** 無料、固定ドメイン、そして
**Cloudflare Access のサービストークンで「App Hosting からの呼び出しだけ」に
絞れる**のが決め手。TryCloudflare(ドメイン不要の使い捨てURL)は PoC 用としては
使えるが、URLが再起動ごとに変わるので本番には向かない。

### 4.2 設定概要

```powershell
# 自宅PC側
winget install Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create socius-llm
# config.yml
#   tunnel: <tunnel-id>
#   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
#   ingress:
#     - hostname: llm.example.com
#       service: http://127.0.0.1:8080
#       originRequest:
#         noTLSVerify: true
#         disableChunkedEncoding: false   # ← SSE を殺さないため
#         connectTimeout: 10s
#     - service: http_status:404
cloudflared tunnel route dns socius-llm llm.example.com
cloudflared service install     # Windows サービスとして常駐
```

Cloudflare 側:

1. **Zero Trust → Access → Applications** で `llm.example.com` を保護
2. **Service Auth** ポリシーを作り、サービストークン(Client ID / Secret)を発行
3. Firebase App Hosting の Secret に格納し、リクエストヘッダに付ける:
   `CF-Access-Client-Id` / `CF-Access-Client-Secret`
4. `llama-server` 側の `--api-key` は二重の鍵として残す

### 4.3 追加レイテンシの内訳 [推定]

| 区間 | 追加 |
| --- | --- |
| App Hosting(asia-northeast1)→ Cloudflare エッジ(東京PoP) | 5〜15ms |
| Cloudflare エッジ ↔ 自宅 cloudflared(既存の常時接続) | 10〜30ms |
| Cloudflare Access のトークン検証 | 1〜5ms |
| **往復合計** | **約 20〜50ms** |

**TTFT 全体(§3.4 の 1〜14秒)に比べれば誤差**。この経路がボトルネックになる
ことはない。

### 4.4 SSE で必ず確認すること

チャンクが**バッファリングされて一括で届く**のがこの構成の典型的な事故。
リポジトリ側は `app/api/chat/route.ts` ですでに `x-accel-buffering: no` を
付けているが、**トンネルの向こう側でも確認が要る**。

```bash
# 文字が1つずつ流れれば OK。かたまりで届いたら設定を疑う
curl -N https://llm.example.com/v1/chat/completions \
  -H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..." \
  -H "Content-Type: application/json" \
  -d '{"model":"swallow","messages":[{"role":"user","content":"長い文章を書いて"}],"stream":true}'
```

### 4.5 この構成の弱点(隠さず書く)

- **自宅の回線とPCが単一障害点。** 停電・回線断・Windows Update の再起動で
  全βユーザーが止まる。→ **だから §5 のフェイルオーバーが最重要になる。**
- **上り帯域**。SSE のトークン列自体は細い(数KB/s)ので家庭回線で足りる。
- **自宅IPは露出しない**(cloudflared は外向き接続のみ)。ここは設計通り安全。

---

## 5. フェイルオーバー設計【最重要】

> **現行コードは変更していません。以下は追加ファイルの設計案です。**
> 差し替えは環境変数1つで切り替わる形にし、既定は現行(Claude のみ)のまま。

### 5.1 いまの抽象化の実態

ご指示の `lib/ai/` は現状存在せず、**実体は `lib/server/anthropic.ts`**。
すでに切れている継ぎ目が3つあり、これが移行を楽にしている:

| 既存の継ぎ目 | 何が良いか |
| --- | --- |
| `lib/server/transcript.ts` | **モデル非依存**。「このアプリの会話」の性質(窓・サニタイズ)をベンダSDKから分離済み。コメントにも明記されている |
| `prompts/` が SDK 非依存 | オフライン検査と Gemini ロールバック経路のために SDK import を持たない。**ローカルモデル用のプロンプト組み立てもそのまま使える** |
| `lib/server/gemini.ts` | 「使われていない戻り道」として保存されている前例がある |

つまり **Gemini → Claude の移行で作った構造が、そのまま Claude → Llama にも効く。**

### 5.2 切り替え点は「最初のチャンク」— ここしかない

`app/api/chat/route.ts` の `openStream()` は、**最初のテキストチャンクを
掴むまでレスポンスを返さない**。コメントにも理由が書いてある —
ボディを返した後はステータスコードが確定してしまい、失敗を「途中で切れた返答」
としてしか見せられないから。

**この設計がそのままフェイルオーバー点になる。**

```
[ローカル試行] ──最初のチャンクを掴めた──→ そのまま流す(Claudeは呼ばない)
      │
      ├─接続できない / TTFT超過 / HTTPエラー / 空チャンク
      ↓
[Claude試行] ──既存の callAnthropic() をそのまま──→ 流す
      │
      └─失敗 → 既存の AiFailure をそのまま返す(学生への文言は変えない)
```

**最初のチャンクより後は切り替えられない**(バイトが出てしまっている)。
よって**切替条件はすべて「最初のチャンクまでに判定できるもの」に限る**。
これは制約ではなく、判定を単純に保つための設計指針。

### 5.3 追加するファイル

```
apps/web/lib/server/ai/
  types.ts      … ChatProvider インタフェース + 共通の Delta/Usage 型
  claude.ts     … 既存 anthropic.ts を ChatProvider に包むだけ(anthropic.ts は無変更)
  local.ts      … llama-server の OpenAI 互換APIを叩く。fetch + SSE パーサ、SDK不要
  health.ts     … ヘルスチェックとサーキットブレーカ
  router.ts     … ローカル優先 → Claude フォールバック
```

```typescript
// types.ts — 両者が満たす最小の形
export type ChatProvider = {
  readonly name: "local" | "claude";
  /**
   * 最初のテキストチャンクを掴むところまで進めて返す。
   * ここで throw されたぶんには、まだ切り替えられる。
   */
  openStream(req: ChatRequest): Promise<OpenStream>;
};

export type OpenStream = {
  /** すでに取り出した最初のテキスト。 */
  head: string;
  /** 残りを1チャンクずつ。 */
  rest: AsyncIterator<string>;
  /** 中断。学生が離脱したときに呼ぶ。 */
  abort(): void;
  usage(): TokenUsage;
};
```

```typescript
// router.ts — 骨子
const LOCAL_TTFT_BUDGET_MS = 6_000;   // これを超えたらローカルを諦める
const LOCAL_CONNECT_TIMEOUT_MS = 800; // つながらないなら即諦める

export async function openChatStream(req: ChatRequest): Promise<OpenStream & { via: string }> {
  if (localEnabled() && breaker.allows()) {
    try {
      const s = await withTimeout(local.openStream(req), LOCAL_TTFT_BUDGET_MS);
      breaker.recordSuccess();
      return { ...s, via: "local" };
    } catch (e) {
      breaker.recordFailure(e);
      console.warn("[ai] ローカルが応えなかったので Claude に回します", e);
      // ここで throw しない。落ちるのは実装の失敗であって、学生の失敗ではない。
    }
  }
  const s = await callAnthropic("api/chat", () => claude.openStream(req));
  return { ...s, via: "claude" };
}
```

### 5.4 切替条件の一覧

| 条件 | しきい値(初期値) | 判定できる時点 | 動作 |
| --- | --- | --- | --- |
| 接続不可 / DNS失敗 | 800ms | 接続時 | 即 Claude |
| TTFT 超過 | **6,000ms** | 最初のチャンク待ち | abort → Claude |
| HTTP 4xx/5xx | — | ヘッダ受信時 | 即 Claude |
| 空の最初チャンク | — | 最初のチャンク | 即 Claude(既存の `empty first chunk` と同じ扱い) |
| **ブレーカ開放中** | 連続3回失敗 → 60秒開放 | 呼ぶ前 | ローカルを試さない |
| モデル未ロード | — | ヘルスチェック | ブレーカを開ける |

**TTFT 6秒の根拠**: §3.4 で窓が滑った直後の正常なプレフィルが 10〜14秒かかる。
つまり **6秒では「正常だが遅い」ケースまで切ってしまう。** これは意図的で、
学生を14秒待たせるより Claude で3秒で返すほうが良い、という判断。
逆に言えば **§3.4 を FT で解決できれば、この予算は現実的な値になる。**
ここは PoC の実測を見てから決めるべき数字。

### 5.5 ヘルスチェック

```typescript
// health.ts — llama-server の /health を叩く
// 15秒間隔。App Hosting は複数インスタンスがあるのでインスタンスごとに持つ
// (共有したいなら Firestore の1ドキュメントに置く)
//   ok        → ブレーカを閉じる
//   3回連続NG → 60秒開放。開放中はローカルを試さない
//   開放後1回 → half-open。1リクエストだけ試して、通れば閉じる
```

### 5.6 見落としやすい差分 — ここが実装の本体

| 差分 | 対処 |
| --- | --- |
| **`cache_control` が無い** | ローカルはシステムを1本の文字列で渡す。`blocksToText()` がすでにある |
| **`[sheet]` を出さない可能性** | `parseWorksheet()` は null を「変わっていない」と解釈する設計なので**壊れはしない**。ただし**記憶が更新されなくなる**ので、`via: "local"` のときの null 率を必ず記録する |
| **usage の形が違う** | OpenAI形式 `{prompt_tokens, completion_tokens}` → `TokenUsage` に写像。**`cacheWrite`/`cacheRead` は 0**。`lib/server/usage.ts` の集計にローカル分が混ざると金額が嘘になるので、**`provider` を添えて別々に集計する** |
| **失敗分類** | `classifyAnthropicFailure()` は Anthropic 専用。ローカル用に `classifyLocalFailure()` を別に持ち、**学生向けの文言は既存のものを再利用**(「混み合っています…」等)。文言を増やさない |
| **1ターンに2プロバイダ分の課金カウント** | フォールバックしたターンは Claude の分だけ数える。ローカル試行は無料 |
| **`max_tokens`** | Claude は 2048(思考込みの余裕)。ローカルは **640 で十分**(返答250字 + sheet)。Swallow 推奨は temperature 0.6 / top_p 0.9 / max_tokens 512 [出典] |

### 5.7 段階導入(既存を壊さない順序)

| 段 | 内容 | ロールバック |
| --- | --- | --- |
| 0 | `lib/server/ai/` を追加。**route.ts は触らない**。ユニット検査だけ(`scripts/check-ai-guards.mjs`) | ファイル削除 |
| 1 | `LLM_PROVIDER=claude`(既定)で route.ts をルータ経由に。**挙動は完全に同じ** | 環境変数 |
| 2 | 開発環境だけ `LLM_PROVIDER=local-first` | 環境変数 |
| 3 | β の一部ユーザー(uid ハッシュで %)だけ local-first | 環境変数 |
| 4 | 全体を local-first | 環境変数 |

**どの段でも `ANTHROPIC_API_KEY` は消さない。** フォールバック先が消える。

---

## 6. コスト比較(50人β想定)

### 6.1 利用量の前提 [推定]

`DAILY_MESSAGE_LIMIT` の既定は **50通/日/人** [実測] だが、これは上限であって
実利用ではない。3つのシナリオを置く:

| | 1人あたり | 月間ターン数(50人) | 月間セッション数 |
| --- | --- | --- | --- |
| 軽 | 週1セッション × 15往復 | 3,225 | 215 |
| **標準** | **週2セッション × 20往復** | **8,600** | **430** |
| 重 | 週3セッション × 25往復 | 16,125 | 645 |

### 6.2 (a) Claude API 現状 [推定]

`claude-sonnet-4-6`(list price): 入力 $3.00 / 出力 $15.00 / キャッシュ書込 1.25× /
キャッシュ読込 0.1× per MTok。155円/$ で換算。

1ターンの内訳(日本語は 1トークン ≒ 2文字):

| | 窓が滑る前(`complete=true`) | 窓が滑った後 |
| --- | --- | --- |
| キャッシュ読込 | 5,000 tok | 2,530 tok(システムのみ) |
| 非キャッシュ入力 | 500 tok | 3,300 tok |
| キャッシュ書込 | 500 tok | 0 |
| 出力 | 275 tok | 275 tok |
| **1ターン** | **$0.0090 ≒ 1.4円** | **$0.0148 ≒ 2.3円** |

混在させて **1ターン ≒ 1.8円**。加えて `/api/extract`(自分史抽出)が
1セッション1回、**1回 ≒ 3.3円**。

| シナリオ | 壁打ち | 抽出 | **月合計** |
| --- | --- | --- | --- |
| 軽 | 5,800円 | 700円 | **約 6,500円** |
| **標準** | **15,500円** | **1,400円** | **約 16,900円** |
| 重 | 29,000円 | 2,100円 | **約 31,100円** |

> **この試算は `npm run measure:cost` の実測値で置き換えてください。**
> あの台本は実APIを叩いて `cache_read_input_tokens` を実際に読むので、
> 上の表より確実です。ここでは鍵を使う実行を避けて机上計算にしています。

### 6.3 (b) 自宅GPU(RTX 3060、170W上限、31円/kWh)

消費電力 [推定]:

| 状態 | GPU | システム全体 |
| --- | --- | --- |
| 生成中 | 170W(上限) | **250W** |
| アイドル(モデルVRAM常駐) | 15W | **80W** |

GPU が実際に働く時間: 1ターン ≒ 8秒(プレフィル1秒 + 275トークン ÷ 40 tok/s)。

| シナリオ | 稼働時間/月 | アイドル/月 | 電力量 | **電気代** |
| --- | --- | --- | --- | --- |
| 軽 | 7.2h | 712.8h | 58.8 kWh | **1,823円** |
| **標準** | **19.1h** | **700.9h** | **60.9 kWh** | **1,888円** |
| 重 | 35.8h | 684.2h | 63.7 kWh | **1,975円** |

**注目すべきは、利用量が5倍になっても電気代がほぼ変わらないこと。**
月720時間の常時稼働のうち、実働は20時間前後(**稼働率 2.7%**)。
**コストの94%はアイドル電力**。つまり自宅GPU の限界費用はほぼゼロで、
固定費だけの構造になっている。

計上していない費用: PC本体(既存、償却外)、回線(既存)、
**Cloudflare Tunnel(無料枠)**、そして **運用工数**。

### 6.4 (c) クラウドGPU

| 構成 | 単価 | 月額(標準シナリオ) | 備考 |
| --- | --- | --- | --- |
| RunPod RTX 4090 Community 24/7 | $0.34/h [出典] | **$245 ≒ 38,000円** | Claude より高い |
| RunPod RTX 4090 Secure 24/7 | $0.69/h [出典] | $497 ≒ 77,000円 | 論外 |
| Vast.ai RTX 4090 24/7 | $0.29〜/h [出典] | $209 ≒ 32,000円 | 可用性が host 依存 |
| **サーバーレス(実働課金)** | 約 $1.10/h | 19.1h × $1.10 = **$21 ≒ 3,300円** | **コールドスタート30〜60秒** |

サーバーレスは金額だけ見ると魅力的だが、**コールドスタートが TTFT に
直撃する**。ウォームワーカーを常駐させると結局 24/7 課金に近づく。

### 6.5 比較表(標準シナリオ、月額)

| | 月額 | 単価の伸び方 | 可用性 | 運用工数 |
| --- | --- | --- | --- | --- |
| **(a) Claude API 現状** | **約 16,900円** | 利用量に**比例** | ◎ SLA あり | ほぼゼロ(いま動いている) |
| **(b) 自宅GPU** | **約 1,900円** | **ほぼ横ばい** | **△ 単一障害点** | 大(セットアップ + 常時稼働の面倒) |
| (c) クラウドGPU 24/7 | 約 38,000円 | 横ばい | ○ | 中 |
| (c') クラウドGPU サーバーレス | 約 3,300円 | 比例 | △ コールドスタート | 中 |

**(b)+(a) のハイブリッド**(§5 のフェイルオーバー)が現実解:
通常は自宅GPU(1,900円)、落ちたときだけ Claude。フォールバック率10%なら
月 1,900 + 1,700 = **約3,600円**。

### 6.6 損益分岐

自宅GPU が Claude を上回るのは **月間ターン数が概ね 1,000 を超えたあたり**
(電気代1,900円 ÷ 1.8円/ターン ≒ 1,060ターン)。50人βはすでにこれを超えている。
ただし §0 で書いたとおり、**差額の月1.5万円は工数に見合わない**。
効いてくるのは 500人〜1,000人規模(月10〜30万円)。

---

## 7. ファインチューニング — unsloth + QLoRA は 12GB で回るか

### 7.1 結論

| やりたいこと | 12GB で回るか |
| --- | --- |
| 8B QLoRA / seq 2,048 / batch 1 | **○ 回る**(約7〜9GB)[推定] |
| 8B QLoRA / seq 4,096 / batch 1 | **△ ぎりぎり**(約10〜11GB)[推定] |
| 8B QLoRA / **seq 8,192**(= 実際の壁打ち1件の長さ) | **× 無理** |
| フル微調整・LoRAマージ後の推論 | 推論は可(Q4_K_M) |

**そして今回の用途が必要とするのは 8,192。** システムプロンプト5,069文字
(≒4,000〜5,000トークン)+ 履歴 + 応答が1サンプルなので、seq 2,048 には入らない。

### 7.2 12GB で回すための条件(短文脈レシピ)

もし 12GB で完結させるなら、**学習サンプルを短くする**しかない:

```python
# 12GB 用の設定 [推定]
max_seq_length      = 2048          # ← ここが制約の本体
load_in_4bit        = True          # QLoRA
r                   = 16            # 32 だと余裕が減る
lora_alpha          = 32
target_modules      = ["q_proj","k_proj","v_proj","o_proj",
                       "gate_proj","up_proj","down_proj"]
use_gradient_checkpointing = "unsloth"
per_device_train_batch_size = 1
gradient_accumulation_steps = 8     # 実効バッチ8
optim               = "adamw_8bit"
```

参考値: RTX 4090 での 8B QLoRA / seq 2,048 のピークは **6.6GB** [出典]。
8GB GPU でも context 2,900 まで通るとされる [出典] ので、12GB なら 2,048 は確実、
4,096 が上限付近。

**短文脈レシピで何を学習させるか**: システムプロンプト全文は入れず、
**「直近3往復 → 次の1返答(+ `[sheet]` ブロック)」** の形に切る。
狙いは知識ではなく**書式と口調の内在化**(§2.3 の4指標)。これなら 2,048 に入る。

### 7.3 本命 — クラウドでFT → GGUF化 → ローカル推論

長文脈でちゃんと学習させるなら、こちらが正しい。

```
[1] 学習データ生成(ローカル、GPU不要)
      Firestore の users/{uid}/sessions/{id}/messages
        → training_data.jsonl
[2] クラウドで QLoRA(RunPod / Lambda。A100 40GB or L40S 48GB)
      seq 8192 / r 32 / 3 epoch
      $1.5〜2.5/h × 2〜4時間 ≒ $5〜10(約800〜1,500円)
[3] LoRA をベースにマージ
      model.save_pretrained_merged(..., save_method="merged_16bit")
[4] GGUF に変換
      python llama.cpp/convert_hf_to_gguf.py ./merged --outtype f16
      ./llama-quantize model-f16.gguf model-Q4_K_M.gguf Q4_K_M
[5] 自宅の llama-server に置く。以降ずっと無料
```

**1回 1,000円程度**。これは自宅で無理をするより圧倒的に安い。
unsloth は GGUF エクスポート(`save_pretrained_gguf`)を内蔵しているので、
[3][4] は1行で済む場合もある。

### 7.4 training_data JSONL の変換仕様

> **注記: `training_data` という名前のファイルもディレクトリも、現時点で
> このリポジトリには存在しません**(全文検索で0件)。以下は
> **Firestore の実スキーマから起こした新規仕様**です。認識が違っていたら
> 指摘してください。

**入力**: `users/{uid}/sessions/{sessionId}/messages/{messageId}`
(`lib/firebase/schema.ts` の `Message` 型)

```typescript
type Message = {
  role: "user" | "ai";
  text: string;          // ← [sheet]/[choices] タグは保存前に剥がされている
  mode: ChatMode | null; // "counselor" | "karakuchi"。AI発言にのみ付く
  createdAt: Date | null;
  choices: string[];
  editedAt: Date | null;
};
```

**出力**: 1行 = 1学習サンプル(ShareGPT / OpenAI messages 形式)

```jsonl
{"messages":[{"role":"system","content":"<buildChatSystemPrompt() の出力>"},{"role":"user","content":"（壁打ちを始めます）"},{"role":"assistant","content":"..."},{"role":"user","content":"3年の春、サッカー部で副キャプテンになりました。"},{"role":"assistant","content":"副キャプテンになられたんですね。…\n\n[sheet]\nphase: 探索\nepisode: サッカー部の副キャプテン\nfacts: 3年の春 / 副キャプテン"}],"meta":{"mode":"counselor","sessionId":"...","rally":1}}
```

**変換規則 — ここを外すと学習が壊れる:**

| 規則 | 理由 |
| --- | --- |
| `role: "ai"` → `"assistant"`、`"user"` → `"user"` | `toAnthropicMessages()` と同じ写像 |
| **先頭が assistant なら `"（壁打ちを始めます）"` を前に挿す** | `toAnthropicMessages()` が本番でやっているのと同一。ここを変えると学習と推論の形がずれる |
| system は **その会話の `mode` と `profile` で組み直す** | トーンが2つある。混ぜると両方が中途半端になる |
| **`[sheet]` ブロックを assistant 応答の末尾に復元する** | **最重要。**Firestore の `text` はタグが剥がされた後。`sessions/{id}.worksheet` のスナップショットから、そのターン時点のシートを再構成して付け直す。**これをやらないと「シートを出さないモデル」を学習させることになる** |
| `editedAt != null` のユーザー発話は**編集後を採用** | 学生が直した言葉が本人の言葉 |
| 1セッション = 1サンプルではなく、**Nターン目までの前方文脈 = 1サンプル**を展開 | 途中から続ける能力を学習させる |
| **窓(16往復)を本番と同じ規則で適用**(`historyWindowWithState`) | 推論時と同じ形にする |
| **個人情報のスクラブ** | 実名・学校名・企業名。βユーザーの会話を学習に使うことへの**同意取得も別途必要**(`agreedToTermsAt` の同意文面に学習利用が含まれているか要確認) |

**書き出しスクリプトの置き場所案**: `apps/web/scripts/export-training-data.mjs`。
既存の `scripts/*.mjs` と同じく `--experimental-strip-types` + `ts-resolve.mjs`
で `prompts/` を直接読める。

### 7.5 データ量の目安

| 目的 | 必要サンプル数 [推定] |
| --- | --- |
| 書式の内在化(`[sheet]`・問い1つ・250字) | **300〜1,000** |
| 口調(じっくり/ストレート)の再現 | 各 500〜1,500 |
| 深掘りの質そのものの改善 | 数千〜。**βのログだけでは足りない** |

50人 × 週2 × 20往復 × 4週 = **月8,600ターン**。前方文脈展開で使えるサンプルは
その数割。**1〜2ヶ月のβで書式FTには十分な量が貯まる。**

---

## 8. ライセンス対応の一覧

> **法的助言ではありません。**最終判断は必ず自社の法務確認を通してください。

### 8.1 Llama 3.1 Community License

原文(§1.b):

> "If you distribute or make available the Llama Materials (or any derivative
> works thereof), or **a product or service (including another AI model) that
> contains any of them**, you shall (A) provide a copy of this Agreement with any
> such Llama Materials; and (B) **prominently display "Built with Llama"** on a
> related website, user interface, blogpost, about page, or product
> documentation." [出典]

**重みを配布せず SaaS として提供するだけの場合に (B) が要るか**は、
"a product or service that contains any of them" の解釈次第で、
**争いのある論点**です。ただし表示コストはほぼゼロなので、
**表示する側に倒すことを推奨**します。

| 義務 | socius-career での対応 |
| --- | --- |
| **「Built with Llama」の目立つ表示** | `/terms` または `/privacy`、あるいはフッターに一行。Meta の FAQ は「新しいGenAIツールの説明の最初の数文で触れれば prominently にあたる」としている [出典] |
| **ライセンス全文の同梱** | 重みを配布しない前提でも、`docs/llama-migration/LICENSE-llama3.1.txt` に置き、`/terms` からリンク |
| **派生モデル名を "Llama" で始める** | FT モデルを**外部に出す場合のみ**。社内利用なら不要。出すなら例: `Llama-3.1-Swallow-socius-8B` |
| **Acceptable Use Policy の遵守** | 就活支援用途は問題なし |
| **700M MAU 条項** | 該当しない(50人β)[出典] |

### 8.2 Swallow 特有 — Gemma 利用規約が重畳する

**Llama 3.1 Swallow **Instruct** v0.5 は Llama 3.1 Community License **と**
Gemma Terms of Use の**両方**に従う必要があります** [出典]。

理由は学習データ: v0.5 の指示チューニングは `Gemma-3-LMSYS-Chat-1M-Synth`
(応答を `gemma-3-27b-it` で生成し、同モデルで棄却サンプリング)を使っている [出典]。
Gemma の出力から作ったデータで学習しているため、Gemma の**使用制限**
(Prohibited Use Policy)が伝播する。

| 義務 | 対応 |
| --- | --- |
| Gemma Prohibited Use Policy の遵守 | 就活支援は問題なし。禁止事項の確認は必要 |
| Gemma 利用規約の同梱 | HF リポジトリの `GEMMA_TERMS_OF_USE.md` を `docs/llama-migration/` に控える |
| **Base モデル(非Instruct)なら Llama ライセンスのみ** | Instruct を使う限りは両方 [出典] |

### 8.3 ELYZA(比較対象として使う場合)

`Llama-3-ELYZA-JP-8B` は **Llama 3 Community License**(3.1 ではない)。
義務の構造は同じ。**PoC で比較に使うだけなら配布は発生しない**ので、
表示義務の判断は本番採用時にすればよい。

### 8.4 Qwen3-Swallow を将来検討する場合の注意

§1.2 で触れた `Qwen3-Swallow-8B-RL-v0.2-AWQ-INT4` は **Qwen ベースであって
Llama ではない**。ライセンス体系が丸ごと変わる(Meta の条項も
「Built with Llama」も適用されない)。方針が「Llama 自社開発」である以上、
**採用するなら方針変更の判断とセットで**。

### 8.5 チェックリスト(本番投入前)

- [ ] `/terms` または フッターに「Built with Llama」を表示
- [ ] `docs/llama-migration/` に Llama 3.1 ライセンス全文を配置
- [ ] 同 Gemma 利用規約を配置
- [ ] Gemma Prohibited Use Policy を読み、抵触しないことを確認
- [ ] **βユーザーの会話ログを学習に使う同意**が利用規約に含まれるか確認(§7.4)
- [ ] FT モデルを外部配布する予定があるなら、モデル名を `Llama-` で始める
- [ ] 法務確認

---

## 9. PoC 最小構成(週末1回)

> **2026-09-20、項目1・2ともご承認いただいた。**以下はその前提
> (Ollama で回し、`llama-server` へ寄せる / Swallow v0.5 が本命、ELYZA は対抗馬)
> で書いてある。

PoC の第一の目的は品質判定ではない。**このレポートの [推定] を [実測] に
置き換えること**で、置き換わる数字は二つに集約される。

1. **日本語トークンの膨張率** — §3 の KV キャッシュ設計も §6 のコスト試算も、
   「Swallow のトークナイザが Claude の何倍で日本語を割るか」の上に乗っている。
   ここが 1.3倍か 1.8倍かで、12GB に何スロット置けるかが変わる。
2. **`[sheet]` を毎ターン正しく出せるか** — §2.3 の4失敗モードのうち、
   記憶に直結する一つ。ここが崩れるなら §7 のファインチューニングは
   「あると良いもの」ではなく前提条件になる。

### 9.1 測る道具は、もう置いてある

この PoC のために三つ足した。**`lib/server/` には一切触れていない**——
本番の経路を変えずに、同じプロンプト・同じ窓・同じシートを両方へ流すため。

| ファイル | 役割 |
| --- | --- |
| `apps/web/scripts/local-llm.mjs` | Claude と同じ引数を取り、同じ形を返す OpenAI 互換クライアント。Ollama と `llama-server` の両方に向く |
| `apps/web/scripts/poc-fixture.mjs` | 20往復の会話原稿と、序盤に仕込む3つの事実。`verify-long-memory` と共用 |
| `apps/web/scripts/poc-llama.mjs` | 20往復流して §2.3 の4指標を数える台本。`--backend=claude` / `--backend=local` |

原稿を共用にしたのは、比較の前提だからである。Claude 側と Swallow 側で台詞が
一文字でも違えば、出てきた差がモデルの差なのか入力の差なのか分からなくなる。

`local-llm.mjs` が変換するのは二箇所だけ。**system ブロック列を一本に畳む**のと、
**`content` 配列を繋ぐ**の。後者は末尾にエピソードシートが同封された回に効く
ので、ここでシートを落とすと測りたいものが測れなくなる——落とさない。
`cache_control` は捨てる(ローカルに課金は無い)。`temperature` は**指定しない**。
下げれば指示遵守率は上がるが、それは本番と違うものを測ることになる。

> **配線の確認は済んでいる** [実測]。OpenAI 互換の偽サーバーを立てて 20往復
> 流し、故意に5回に1回シートを落としたところ `sheetMissingPct: 20` と出た。
> タグは本文から剥がれ、選択肢は解析され、`prompt_tokens` / `predicted_per_second`
> も拾えている。**GPU 側で確かめることは、モデルの振る舞いだけに絞れる。**

### 9.2 立てる — 所要15分

```powershell
# 1. インストーラ: https://ollama.com/download/windows

# 2. システム環境変数(設定後に Ollama を再起動)
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "2", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "-1", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "1", "Machine")
[Environment]::SetEnvironmentVariable("OLLAMA_KV_CACHE_TYPE", "q8_0", "Machine")

# 3. 本命と対抗馬
ollama pull okamototk/llama-swallow:8b     # Swallow v0.5 Q4_K_M(4.92GB)
ollama pull elyza/Llama-3-ELYZA-JP-8B      # 対抗馬(§2.1)

# 4. 疎通 — ここが通らなければ以降は全部無駄なので、先に見る
curl http://localhost:11434/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "okamototk/llama-swallow:8b",
  "messages": [{"role":"user","content":"こんにちは"}]
}'

# 5. VRAM の実際の占有(4.92GB + コンテキスト分に収まっているか)
nvidia-smi --query-gpu=memory.used,memory.total --format=csv
```

`ollama ps` が `100% GPU` と出ていることを確認する。`CPU` が混ざっていたら
速度の数字は全部意味を失うので、そこで一度止める。

### 9.3 流す

```powershell
cd apps\web

# 基準線。Claude の実測を先に取る(約24リクエスト、§6 の単価で数円)
npm run poc:llama -- --backend=claude

# 本命
$env:LOCAL_LLM_URL="http://127.0.0.1:11434/v1"
$env:LOCAL_LLM_MODEL="okamototk/llama-swallow:8b"
npm run poc:llama -- --backend=local

# 対抗馬
$env:LOCAL_LLM_MODEL="elyza/Llama-3-ELYZA-JP-8B"
npm run poc:llama -- --backend=local
```

各走行の最後に JSON が一行出る。三本並べればそのまま比較表になる。

**トークン膨張率は、この三本から自動的に出る。**同じシステムプロンプトと同じ
履歴を送っているので、Claude 側の `in`(= `input_tokens`)と ローカル側の `in`
(= `prompt_tokens`)の比が、そのまま日本語の割られ方の違いである。rally 20 の
値どうしを割るのがいちばん素直で、その一つの数で §3 と §6 の [推定] が
まとめて [実測] に変わる。

### 9.4 採点表

機械が読む4指標。`poc-llama.mjs` が数える。

| 指標 | 何が壊れるか | 続行の線 |
| --- | --- | --- |
| `sheetMissingPct` | **記憶。**16往復から溢れた話を持ち回る唯一の仕組み | **0%** — 一度でも落ちたら、プロンプトだけでは足りない |
| `multiQuestionPct` | 深掘りが浅くなる(コア原則3) | 10%以下 |
| `overLengthPct` | 吹き出しのUIが崩れる(コア原則5、250字) | 20%以下 |
| `markdownPct` | 同上(コア原則9) | 10%以下 |
| `memoryRecalled` | 8/18 のβ報告「最初の話を忘れている」の再発 | **3/3** |

`sheetMissingPct` と `memoryRecalled` だけ線が厳しいのは、この二つが
**学生から見えてしまう失敗**だからである。250字を10回に2回超えるのは読みにくい
UI だが、序盤の話を忘れるのは製品が成立していない状態にあたる。

人手で見る一つ。**結論・要約・評価を先に出していないか**(コア原則1・4)。
これは機械で見分けられない——「なるほど、つまりあなたは調整役なんですね」は
文法的に何も違反していないのに、「AIが答えを出す場ではない」という製品の前提を
壊している。20往復のログを通しで読んで、**先回りした回を数える**。
Claude 側の同じログを並べて読むこと。絶対数ではなく差を見る。

### 9.5 週末1日の割り振り

門(⏸)を通らなければそこで止める。止まったことも結果であって、
半端な数字を持って帰るより早い。

| 時刻 | やること | 門 |
| --- | --- | --- |
| 09:00–09:30 | 9.2 のセットアップ | ⏸ `ollama ps` が `100% GPU` |
| 09:30–10:00 | Claude 基準線 | ⏸ JSON が出る |
| 10:00–11:00 | Swallow 第一走 | ⏸ `sheetMissingPct` — **ここが本番** |
| 11:00–12:00 | トークン膨張率を出し、§3/§6 の数字を引き直す | — |
| 13:00–14:00 | ELYZA 対抗馬 | — |
| 14:00–15:00 | 同時2接続(2窓で同時に叩き、VRAM と速度を見る) | ⏸ OOM せず 2接続が捌けるか |
| 15:00–16:00 | 人手評価(先回りした回を数える) | — |
| 16:00–17:00 | 結果をこのレポートに書き戻す | — |

**17:00 時点で得られているべきもの**は三つ。トークン膨張率の実数、
Swallow の4指標、そして「§7 のファインチューニングが必須かどうか」の答え。
三つ目は一つ目・二つ目から機械的に決まる——`sheetMissingPct` が 0% でないなら
必須、0% なら当面は不要。

### 9.6 この日にやらないこと

- **`llama-server` への差し替え**。同じ GGUF がそのまま動くので、PoC の結論が
  出てからでいい(§1.3)。
- **Cloudflare Tunnel と本番接続**(§4)。モデルが使えないと分かった日に
  経路だけ通っていても仕方がない。
- **ファインチューニング**(§7)。必要かどうかを決めるのがこの日の仕事で、
  やるかどうかは翌週の話。

---

## 参考

### スタック
- [OpenAI-Compatible Server — vLLM](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/)
- [GGUF — vLLM(実験的・OOTプラグイン化)](https://github.com/vllm-project/vllm/blob/main/docs/features/quantization/gguf.md)
- [llama.cpp server README(スロット・継続バッチング)](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [Parallelization / Batching Explanation — llama.cpp Discussion #4130](https://github.com/ggml-org/llama.cpp/discussions/4130)
- [OpenAI compatibility — Ollama](https://docs.ollama.com/api/openai-compatibility)
- [Ollama vs vLLM: Performance Benchmark 2026 — SitePoint](https://www.sitepoint.com/ollama-vs-vllm-performance-benchmark-2026/)
- [Ollama vs vLLM in 2026: 16x Throughput, 5 User Cutoff — particula.tech](https://particula.tech/blog/ollama-vs-vllm-comparison)
- [llama.cpp vs. vLLM: Choosing the right local LLM inference engine — Red Hat Developer](https://developers.redhat.com/articles/2026/06/15/llamacpp-vs-vllm-choosing-right-local-llm-inference-engine)
- [Conserving Memory — vLLM](https://docs.vllm.ai/en/latest/configuration/conserving_memory/)

### モデル
- [Llama 3.1 Swallow v0.5 — Swallow LLM](https://swallow-llm.github.io/llama3.1-swallow-8B-v0.5.ja.html)
- [tokyotech-llm/Llama-3.1-Swallow-8B-Instruct-v0.5 — Hugging Face](https://huggingface.co/tokyotech-llm/Llama-3.1-Swallow-8B-Instruct-v0.5)
- [okamototk/llama-swallow:8b — Ollama](https://ollama.com/okamototk/llama-swallow:8b)
- [mmnga/Llama-3.1-Swallow-8B-Instruct-v0.5-gguf](https://huggingface.co/mmnga/Llama-3.1-Swallow-8B-Instruct-v0.5-gguf)
- [Llama 3 Swallow — 語彙拡張を行わなかった理由](https://swallow-llm.github.io/llama3-swallow.en.html)
- [elyza/Llama-3-ELYZA-JP-8B-GGUF — Hugging Face](https://huggingface.co/elyza/Llama-3-ELYZA-JP-8B-GGUF)
- [ELYZA、Llama 3.1ベースの日本語モデル(70B)を開発 — PR TIMES](https://prtimes.jp/main/html/rd/p/000000052.000047565.html)
- [tokyotech-llm/Qwen3-Swallow-8B-RL-v0.2-AWQ-INT4](https://huggingface.co/tokyotech-llm/Qwen3-Swallow-8B-RL-v0.2-AWQ-INT4)
- [Qwen3-8B on RTX 3060 12GB: Q4_K_M GGUF — smeltcore](https://smeltcore.com/recipes/qwen3-8b-on-rtx-3060-12gb-q4-k-m-gguf-via-ollama-or-llama-cpp/)

### 接続・FT・ライセンス
- [Cloudflare Tunnel — Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare Tunnels for Self-Hosting — gilricardo.com(レイテンシ 10〜40ms)](https://www.gilricardo.com/blog/cloudflare-tunnels-self-hosting-home-lab)
- [Finetune Llama 3.1 with Unsloth](https://unsloth.ai/blog/llama3-1)
- [Unsloth Benchmarks](https://unsloth.ai/docs/basics/unsloth-benchmarks)
- [Llama 3.1 Community License Agreement](https://developer.meta.com/ai/llama3_1/license/)
- [Llama FAQs(「prominently」の解釈)](https://www.llama.com/faq/)
- [GEMMA_TERMS_OF_USE.md — Swallow v0.5 リポジトリ](https://huggingface.co/tokyotech-llm/Llama-3.1-Swallow-8B-Instruct-v0.5/blob/main/GEMMA_TERMS_OF_USE.md)
- [RunPod Pricing 2026](https://www.runpod.io/articles/guides/top-cloud-gpu-providers)
- [Vast.ai RTX 4090 Price — SynpixCloud](https://www.synpixcloud.com/blog/vast-ai-vs-runpod-rtx-4090-pricing)
