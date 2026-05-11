/**
 * Search-text helpers shared between client-side filtering and any
 * server-side fallback. The normalizer strips diacritics + lowercases
 * so "João Almeida" matches a search for "joao alm", "Andre" matches
 * "André", etc.
 *
 * Server-side queries against Postgres should rely on the `unaccent`
 * extension via raw SQL — JavaScript normalization isn't enough when the
 * search is paginated, because the matching row may live beyond the
 * client-fetched window.
 */

/**
 * Lowercase + strip diacritics. Idempotent. Safe to apply repeatedly.
 *
 *   normalizeForSearch("João Almeida")  // "joao almeida"
 *   normalizeForSearch("André")          // "andre"
 *   normalizeForSearch("Müller")         // "muller"
 *   normalizeForSearch("ÆON")            // "æon"  (æ is a letter, not a diacritic)
 */
export function normalizeForSearch(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** True when `query` (normalized) is a substring of `value` (normalized). */
export function nameMatchesSearch(value: string, query: string): boolean {
  if (!query) return true;
  return normalizeForSearch(value).includes(normalizeForSearch(query));
}
