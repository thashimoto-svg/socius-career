/**
 * ローカルの Llama を、Claude と同じ形で呼べるようにするだけの層。
 *
 * PoC の目的は「Swallow が使えるか」を測ることであって、アプリを Llama 用に
 * 書き直すことではない。だからここは `lib/server/` には一切触らない——
 * `getAnthropic().messages.create(...)` に渡すのと**同じ引数**を受け取り、
 * **同じ形**を返す関数を一つだけ置く。評価台本は呼び先を差し替えるだけで済み、
 * プロンプトも窓もシートも本番のまま動く。
 *
 * これは比較の前提でもある。system も messages も本番の組み立てを通ったものを
 * そのまま両方へ流さないと、測っているのがモデルの差なのか変換の差なのか
 * 分からなくなる。
 *
 * Ollama も llama.cpp の `llama-server` も OpenAI 互換の
 * `/v1/chat/completions` を持っているので、この一枚で両方に向く。
 *
 *   LOCAL_LLM_URL=http://127.0.0.1:11434/v1   # Ollama(PoC)
 *   LOCAL_LLM_URL=http://127.0.0.1:8080/v1    # llama-server(β本番)
 */

/** Ollama の既定。llama-server に向けるときは環境変数で上書きする。 */
const BASE_URL = process.env.LOCAL_LLM_URL || "http://127.0.0.1:11434/v1";

export const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL || "okamototk/llama-swallow:8b";

/**
 * Claude の system ブロック列を、一本の文字列に畳む。
 *
 * 本番では `buildChatSystemBlocks()` が複数ブロックを返すが、それは
 * cache_control を挟む位置を作るためであって、意味の切れ目ではない。
 * ローカルにプレフィックスキャッシュの概念は無い(llama-server のスロット
 * キャッシュはプロセス側が勝手にやる)ので、ここでは素直に連結する。
 * 区切りが消えてモデルの読み方が変わらないよう、改行二つで繋ぐ。
 */
function flattenSystem(system) {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return "";
  return system
    .map((block) => (typeof block === "string" ? block : (block.text ?? "")))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Claude の messages を OpenAI 形式へ。
 *
 * content が配列になるのは、末尾にエピソードシートを同封した回だけ
 * (`toAnthropicMessages` の appended)。ローカルでは cache_control に意味が
 * 無いので、テキストだけを順に取り出して繋ぐ——**シートは落とさない**。
 * ここで落とすと、測りたかった「シートを持ち回れるか」が測れなくなる。
 */
function flattenMessages(messages) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content
            .map((block) => block.text ?? "")
            .filter(Boolean)
            .join("\n\n"),
  }));
}

/**
 * 一往復。`messages.create()` と同じ引数を取り、同じ形を返す。
 *
 * 返す `usage` は Claude の語彙に寄せてある(`input_tokens` /
 * `output_tokens`)ので、そのまま `toTokenUsage()` に渡せる。キャッシュの
 * 二項目は常に 0 ——ローカルに課金は無く、0 のままであることが
 * 「ここは Claude ではない」という印にもなる。
 *
 * `timings` は llama-server が返してくれる実測値。Ollama は返さないので、
 * その場合だけ壁時計から割り出す。**壁時計の tok/s はプレフィルを含むので
 * 生成速度より低く出る**——この二つを混ぜて平均しないために、どちらの出どころか
 * を `timingSource` で申告する。
 */
export async function localMessages({ model, max_tokens, system, messages }) {
  const started = performance.now();

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // llama-server は --api-key を付けて起動する。Ollama は無視する。
      ...(process.env.LOCAL_LLM_KEY
        ? { Authorization: `Bearer ${process.env.LOCAL_LLM_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model: model || LOCAL_MODEL,
      max_tokens,
      // 本番の /api/chat は temperature を指定していない(Claude の既定)。
      // ここで勝手に下げると「指示に従う率」が上振れして、本番と違うものを
      // 測ることになる。合わせる先は本番であって、良い数字ではない。
      messages: [
        ...(flattenSystem(system) ? [{ role: "system", content: flattenSystem(system) }] : []),
        ...flattenMessages(messages),
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ローカルLLM ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const elapsedMs = performance.now() - started;

  const text = json.choices?.[0]?.message?.content ?? "";
  const t = json.timings;

  return {
    // Claude の content 配列に合わせる。readReply は text ブロックしか見ない。
    content: [{ type: "text", text }],
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    stop_reason: json.choices?.[0]?.finish_reason ?? null,
    /** 測定用。Claude 側の戻りには無いので、使う側は任意項目として扱う。 */
    local: t?.predicted_per_second
      ? {
          elapsedMs,
          tokensPerSecond: t.predicted_per_second,
          prefillPerSecond: t.prompt_per_second ?? null,
          timingSource: "llama-server",
        }
      : {
          elapsedMs,
          tokensPerSecond: (json.usage?.completion_tokens ?? 0) / (elapsedMs / 1000),
          prefillPerSecond: null,
          timingSource: "壁時計(プレフィル込み)",
        },
  };
}

/** 立っているか、どのモデルが載っているかを先に確かめる。 */
export async function localHealth() {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: process.env.LOCAL_LLM_KEY
      ? { Authorization: `Bearer ${process.env.LOCAL_LLM_KEY}` }
      : {},
  });
  if (!res.ok) throw new Error(`${BASE_URL} が応答しません (${res.status})`);
  const json = await res.json();
  return { url: BASE_URL, models: (json.data ?? []).map((m) => m.id) };
}
