/**
 * エピソードシートを、書いた側——サーバー——が保存する。
 *
 * 進捗レールを保存していたのはクライアントだった。シートも同じようにできるが、
 * しない理由が二つある。
 *
 * - シートはモデルの出力そのもので、剥がす前の返答を持っているのはサーバーだけ。
 *   保存をクライアントに任せると、全文が届ききったかどうかに保存が依存する。
 *   タブを閉じた回・回線が切れた回に、その回の整理だけが落ちる。
 * - シートは次のターンの依頼に同封される。学生が離脱した壁打ちを別の端末から
 *   開き直したとき、記憶が残っているかどうかがブラウザ側の後始末に懸かっている
 *   のは、記憶と呼べるものではない。
 *
 * 経路は lib/server/usage.ts と同じで、理由も同じ: Firestore REST を学生自身の
 * IDトークンで叩く。ルートハンドラはFirestoreの資格情報を持たない。サーバーが
 * 触れるのは学生自身が触れるものだけで、それを保証しているのが firestore.rules。
 */

import {
  toProgress,
  worksheetProgress,
  type ProgressStep,
  type Worksheet,
} from "@socius/prompts";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/**
 * 保存に与える時間。
 *
 * 返答を返し終えたあとに走るので、学生は誰も待っていない。それでも上限を切るのは、
 * 応答しないFirestoreに繋いだままのリクエストがサーバーに溜まるのを避けるため。
 */
const WORKSHEET_TIMEOUT_MS = 5_000;

/**
 * Firestore のドキュメントIDとして安全か。
 *
 * これはパスに埋め込まれる、リクエストボディ由来の唯一の値。自動生成のIDは20字の
 * 英数字で、この形から外れるものを受け取る理由がない——`..` や `/` を弾くのが目的
 * で、形式の厳密さが目的ではない。
 */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

type FirestoreValue =
  | { stringValue: string }
  | { arrayValue: { values: { stringValue: string }[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

function stringsValue(items: readonly string[]): FirestoreValue {
  return { arrayValue: { values: items.map((v) => ({ stringValue: v })) } };
}

/** The sheet in Firestore's own vocabulary. */
function worksheetValue(sheet: Worksheet): FirestoreValue {
  return {
    mapValue: {
      fields: {
        phase: { stringValue: sheet.phase },
        episode: { stringValue: sheet.episode },
        situation: { stringValue: sheet.situation },
        task: { stringValue: sheet.task },
        action: { stringValue: sheet.action },
        result: { stringValue: sheet.result },
        learning: { stringValue: sheet.learning },
        motive: { stringValue: sheet.motive },
        pending: stringsValue(sheet.pending),
      },
    },
  };
}

/**
 * Store this turn's sheet, and the rail derived from it.
 *
 * Two fields in one PATCH, because they are one fact: the rail shows which of
 * the five 節 have something written in them, and reading it off the sheet is
 * what keeps 「揃いました」 from disagreeing with what the student sees when they
 * open the sheet to look.
 *
 * `updatedAt` is deliberately not touched, the same way markExtracted leaves
 * it alone: the reply that carried this sheet has already moved it, and a
 * second write would reorder the 履歴 list for a reason the student did nothing
 * to cause.
 */
export async function saveWorksheet(
  uid: string,
  idToken: string,
  sessionId: string,
  sheet: Worksheet,
): Promise<void> {
  const progress: ProgressStep[] = worksheetProgress(sheet);

  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/users/${uid}/sessions/${sessionId}` +
    `?updateMask.fieldPaths=worksheet&updateMask.fieldPaths=progress`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        worksheet: worksheetValue(sheet),
        progress: stringsValue(toProgress(progress)),
      },
    }),
    signal: AbortSignal.timeout(WORKSHEET_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`worksheet write failed: ${res.status} ${await res.text()}`);
  }
}
