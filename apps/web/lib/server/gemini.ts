import { GoogleGenAI } from "@google/genai";

/**
 * Server-only Gemini client.
 *
 * GEMINI_API_KEY has no NEXT_PUBLIC_ prefix on purpose: it must never reach the
 * browser, so every call goes through a route handler.
 */

let client: GoogleGenAI | undefined;

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to apps/web/.env.local and restart the dev server.",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * 2.5 Flash for both paths: the 壁打ち is a turn-by-turn conversation where a
 * slow reply reads as the app being broken, and the extraction is a
 * restructuring job rather than a reasoning one.
 */
export const CHAT_MODEL = "gemini-2.5-flash";
export const EXTRACT_MODEL = "gemini-2.5-flash";

/** One transcript line, in the shape both route handlers accept. */
export type WireMessage = { role: "user" | "ai"; text: string };

const MAX_TEXT = 8000;
const MAX_MESSAGES = 40;

/**
 * Coerce whatever the client posted into a transcript, dropping anything
 * malformed. The browser is not a trusted source even when the student is.
 */
export function parseMessages(value: unknown): WireMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (m): m is WireMessage =>
        !!m &&
        typeof m === "object" &&
        (m as WireMessage).role !== undefined &&
        typeof (m as WireMessage).text === "string",
    )
    .map((m) => ({
      role: m.role === "ai" ? ("ai" as const) : ("user" as const),
      text: m.text.slice(0, MAX_TEXT),
    }))
    .filter((m) => m.text.trim().length > 0)
    .slice(-MAX_MESSAGES);
}

/** Gemini calls the assistant side "model"; the app calls it "ai". */
export function toGeminiContents(messages: WireMessage[]) {
  return messages.map((m) => ({
    role: m.role === "ai" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
}
