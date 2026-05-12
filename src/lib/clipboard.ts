// Copy text to the clipboard with fallbacks.
//
// `navigator.clipboard.writeText` is the modern path, but it throws
// `NotAllowedError: Document is not focused` on desktop browsers when
// focus is on devtools or a popup, and it isn't always available on
// older WebViews. We focus first, then try the modern API, then fall
// back to the legacy execCommand textarea trick.
//
// Returns `true` on success, `false` if all paths failed.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof window !== "undefined") window.focus();
  } catch {}

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy path.
    }
  }

  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}
  }

  return false;
}
