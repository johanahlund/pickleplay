/**
 * Tiny client-side preview cache for instant render-on-navigate UX.
 *
 * When a user clicks on an item in a list (e.g. an event card), the list
 * page already has the basic data for that entity. Stashing it here lets
 * the detail page render the header immediately on first paint instead of
 * showing a "Loading..." placeholder. The detail page still fetches the
 * full record in the background and replaces the preview with the fresh
 * data when it arrives.
 *
 * Storage is sessionStorage so previews survive route transitions but not
 * full page reloads (fresh page = fresh data). Keys are namespaced by
 * entity type: `event:abc123`, `club:xyz789`, etc.
 *
 * This is intentionally lightweight — no React state, no subscriptions.
 * Callers read once on mount to get initial render data.
 */

const PREFIX = "preview:";

export type EntityType = "event" | "club" | "league" | "player";

function key(type: EntityType, id: string): string {
  return `${PREFIX}${type}:${id}`;
}

/** Save a preview. Silently fails if sessionStorage is unavailable. */
export function setPreview<T>(type: EntityType, id: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key(type, id), JSON.stringify(data));
  } catch {
    // Quota exceeded or disabled — not critical, just skip.
  }
}

/** Read a preview. Returns null if not found, expired, or unparseable. */
export function getPreview<T>(type: EntityType, id: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key(type, id));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Clear a specific preview. */
export function clearPreview(type: EntityType, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key(type, id));
  } catch {
    // ignore
  }
}
