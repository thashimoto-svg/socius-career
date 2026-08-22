/**
 * Put text on the clipboard, wherever the app is running.
 *
 * `navigator.clipboard` is the whole answer on a modern browser over https,
 * which is what production is. It is *not* the answer in the two places this
 * app actually gets opened from: an in-app browser (LINE, Instagram) can be
 * missing the permission, and a Codespaces preview served over http has no
 * secure context at all, so `navigator.clipboard` is simply undefined there.
 *
 * `execCommand("copy")` is deprecated and still works in every one of those.
 * It needs a real selection, which means a real element in the document — the
 * off-screen textarea below — and it must run inside the gesture that asked
 * for it, which is why nothing here awaits anything before trying.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, or no permission in this browser. The fallback still might work.
  }

  try {
    const field = document.createElement("textarea");
    field.value = text;
    // Off-screen rather than hidden: `display: none` cannot be selected, and a
    // field that is merely invisible would still scroll the page to itself.
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}
