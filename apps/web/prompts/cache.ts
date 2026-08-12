/**
 * System prompts as cacheable blocks.
 *
 * Anthropic's prompt cache is a **prefix match**: everything up to a
 * `cache_control` marker is stored, and a single byte earlier in the prefix
 * invalidates it. That makes the order of the layers a cost decision rather
 * than a stylistic one, which is why the assembly moved out of a `join("\n\n")`
 * and into here.
 *
 * The type is written out by hand rather than imported from the SDK. This
 * directory is deliberately free of SDK imports — the offline guard scripts and
 * the Gemini rollback path both read these modules, and neither should have to
 * install `@anthropic-ai/sdk` to do it. The route handlers cast at the seam,
 * the same way they already do for the tool schemas.
 */

export type PromptBlock = {
  type: "text";
  text: string;
  /**
   * "Cache everything up to and including this block."
   *
   * `ephemeral` is a 5-minute TTL. The 1-hour TTL costs double to write and
   * needs three reads rather than two to pay for itself; nothing here is idle
   * that long between requests while a student is mid-壁打ち.
   */
  cache_control?: { type: "ephemeral" };
};

/**
 * The floor the whole scheme rests on.
 *
 * Below this many tokens the API silently declines to cache — no error, a
 * `cache_creation_input_tokens` of zero, and a write premium paid for a cache
 * that was never created. It is model-specific, and 1024 is the figure for the
 * Sonnet 4.x family this app runs on. It is recorded here because every
 * breakpoint below was placed against a measurement (scripts/measure-cache-prefix.mjs),
 * and the next person to edit a prompt layer needs to know that shortening one
 * can silently switch caching off rather than merely making it cheaper.
 */
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;

/** Convenience for the callers that still want one string. */
export function blocksToText(blocks: PromptBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}
