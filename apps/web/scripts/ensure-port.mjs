/**
 * Refuse to start on any port but the one the app is allowed to sign in from.
 *
 * Next's dev server treats a busy port as something to route around: it retries
 * up to ten times and moves on with a warning (server/lib/start-server.js).
 * That is the right instinct for a generic tool and the wrong one here, because
 * this app's Google sign-in only works from the exact hostname listed in
 * Firebase Auth's 承認済みドメイン. Land on 3001 and every sign-in fails with
 * auth/unauthorized-domain — an error whose text is about the domain and whose
 * cause is a process nobody remembers starting.
 *
 * So the drift is stopped where it starts. A warning that scrolls past is not a
 * guard; a non-zero exit is.
 *
 *   node scripts/ensure-port.mjs 3000
 */
import { createServer } from "node:net";
import { execSync } from "node:child_process";

const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`ensure-port: ポート番号が不正です: ${process.argv[2]}`);
  process.exit(1);
}

/** Who is holding it. Best-effort — the advice is useful without a pid. */
function holder() {
  for (const cmd of [
    `ss -ltnp 2>/dev/null | grep -w ':${port}'`,
    `lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null`,
  ]) {
    try {
      const out = execSync(cmd, { encoding: "utf8", shell: "/bin/bash" }).trim();
      if (out) return out;
    } catch {
      // Not installed, or nothing matched. Try the next one.
    }
  }
  return null;
}

const probe = createServer();

probe.once("error", (err) => {
  if (err.code !== "EADDRINUSE") {
    console.error(`ensure-port: ポート ${port} を確認できませんでした:`, err.message);
    process.exit(1);
  }

  const who = holder();

  console.error(`
❌ ポート ${port} は既に使われています。

このアプリは ${port} 番でしか Google サインインできません。Firebase Auth の
承認済みドメインがそのホスト名で登録されているためで、別のポートで起動すると
サインインが auth/unauthorized-domain で失敗します。だから逃げずに止まります。

${who ? `掴んでいるプロセス:\n${who}\n` : ""}
古いサーバーを落としてから、もう一度:

    npm run stop     # ${port} 番を掴んでいるプロセスを落とす
    npm run dev
`);
  process.exit(1);
});

probe.once("listening", () => {
  probe.close(() => process.exit(0));
});

// The dev server binds on all interfaces, so the check has to as well —
// probing only 127.0.0.1 would miss a process bound to 0.0.0.0.
probe.listen(port, "0.0.0.0");
