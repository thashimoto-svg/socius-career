/**
 * Reject if `promise` has not settled within `ms`.
 *
 * Firestore treats an unreachable backend as something to keep retrying rather
 * than something to fail, so a read that cannot land never rejects — and a
 * screen waiting on one sits on 「読み込んでいます…」 with nothing to show and
 * nothing to do. A deadline turns silence into an error the student can act on.
 *
 * The underlying work is not cancelled; nothing here can cancel it. It is
 * simply no longer awaited.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
