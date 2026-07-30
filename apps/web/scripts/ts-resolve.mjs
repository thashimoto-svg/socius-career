/**
 * Let the scripts in this directory import the app's own TypeScript modules.
 *
 * `node --experimental-strip-types` runs .ts files but resolves specifiers the
 * way ESM does, so the extensionless relative imports the app is written with
 * ("./core", "./modes/index") do not resolve. This fills that gap, which is
 * what lets a verification script exercise the real prompt and the real retry
 * logic rather than a copy of them that can quietly drift.
 *
 * Used as: node --experimental-strip-types --import ./scripts/ts-resolve.mjs …
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".")) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Not that one; fall through to the next shape, then to plain ESM.
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
