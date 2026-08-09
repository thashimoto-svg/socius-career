/**
 * Free the one port this app is allowed to run on.
 *
 * The companion to ensure-port. That script refuses to start and tells you to
 * run this one; without it the advice would be "find the pid yourself", which
 * is the step people skip by starting on 3001 instead — which is the failure
 * this pair exists to prevent.
 *
 *   node scripts/stop-port.mjs 3000
 */
import { execSync } from "node:child_process";

const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`stop-port: ポート番号が不正です: ${process.argv[2]}`);
  process.exit(1);
}

/** Every pid listening on the port. */
function listeners() {
  for (const cmd of [
    `lsof -t -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null`,
    `ss -ltnpH 2>/dev/null | grep -w ':${port}' | grep -o 'pid=[0-9]*' | cut -d= -f2`,
  ]) {
    try {
      const pids = execSync(cmd, { encoding: "utf8", shell: "/bin/bash" })
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
      if (pids.length > 0) return [...new Set(pids)];
    } catch {
      // Not installed, or nothing matched. Try the next one.
    }
  }
  return [];
}

const pids = listeners();

if (pids.length === 0) {
  console.log(`ポート ${port} は空いています。`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    // SIGTERM, not SIGKILL: the dev server has a .next/dev cache to flush, and
    // killing it mid-write is how you get a corrupt cache that looks like a
    // compile bug tomorrow.
    process.kill(pid, "SIGTERM");
    console.log(`ポート ${port} の pid ${pid} に SIGTERM を送りました。`);
  } catch (e) {
    console.error(
      `pid ${pid} を落とせませんでした (${e.code}). ` +
        `別のユーザーのプロセスかもしれません。`,
    );
    process.exit(1);
  }
}
