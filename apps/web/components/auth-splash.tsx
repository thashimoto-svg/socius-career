import { fs, T } from "@/lib/theme";

/**
 * Shown while Firebase restores the persisted session, and during the brief
 * moment before a redirect lands. Deliberately quiet — a spinner here would
 * read as "something is wrong" on what is usually a sub-second wait.
 */
export function AuthSplash() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: T.sub,
        fontSize: fs(12),
      }}
    >
      読み込んでいます…
    </div>
  );
}
