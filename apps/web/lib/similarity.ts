/**
 * "Is this the same episode we already saved?"
 *
 * Extraction runs repeatedly over a growing 壁打ち, so the same story gets
 * looked at many times and comes back worded slightly differently each run —
 * 「サッカー部で集合時間を前倒しにした話」 one time, 「集合時間を10分前倒しにした提案」
 * the next. String equality would let both onto the 自分史 as separate cards.
 *
 * The model is already told what has been saved and asked not to repeat it;
 * this is the check that catches it when it does anyway.
 */

/**
 * Strip everything that varies without changing which episode is meant:
 * width, case, spacing, and the punctuation Japanese titles pick up.
 */
function normalize(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。，．・…!?！？「」『』（）()【】\-—–~〜:：;；"'"']/g, "");
}

/** Every adjacent pair of characters. Single characters are their own bigram. */
function bigrams(text: string): string[] {
  if (text.length < 2) return text.length === 1 ? [text] : [];
  const pairs: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) pairs.push(text.slice(i, i + 2));
  return pairs;
}

/**
 * Dice coefficient over character bigrams, 0 to 1.
 *
 * Bigrams rather than words because Japanese does not space its words, so a
 * token-based measure would need a tokenizer to say anything at all. Bigrams
 * also survive the reordering that rewording a title tends to do.
 */
export function titleSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // One title being a rewrite of the other with a clause added is the common
  // case, and bigram overlap already scores it high — but containment is
  // certain where overlap is only likely, so it short-circuits.
  if (x.includes(y) || y.includes(x)) return 1;

  const left = bigrams(x);
  const right = bigrams(y);
  if (left.length === 0 || right.length === 0) return 0;

  // Counted rather than set-compared: a title that repeats a phrase should not
  // match one that says it once as strongly as one that says it twice.
  const pool = new Map<string, number>();
  for (const g of left) pool.set(g, (pool.get(g) ?? 0) + 1);

  let shared = 0;
  for (const g of right) {
    const left_ = pool.get(g) ?? 0;
    if (left_ > 0) {
      shared += 1;
      pool.set(g, left_ - 1);
    }
  }

  return (2 * shared) / (left.length + right.length);
}

/**
 * Where "close enough to be the same episode" sits.
 *
 * Deliberately not near 1: the cost of the two errors is not symmetric. Merging
 * two genuinely different episodes loses one of the student's stories, so the
 * bar cannot be low; but a duplicate card is visible and annoying, and they can
 * delete it. 0.62 is roughly "most of the title is the same words".
 */
export const SAME_EPISODE_THRESHOLD = 0.62;

export function isSameEpisode(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= SAME_EPISODE_THRESHOLD;
}
