/**
 * Parse a pasted, line-separated list of player names. Cleans leading
 * emoji / bullets / non-letter junk and trailing punctuation, dedupes
 * case-insensitively, and drops lines that are too short to be a name.
 */
export interface ParsedLine {
  raw: string;
  name: string;
}

export function parsePlayerList(input: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/\r?\n/)) {
    const s = cleanLine(raw);
    if (s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, name: s });
  }
  return out;
}

function cleanLine(raw: string): string {
  let s = raw.trim();
  // Strip everything before the first Unicode letter (emoji, bullets, dashes, numbers).
  const lead = s.match(/^[^\p{L}]*/u);
  if (lead) s = s.slice(lead[0].length);
  // Strip trailing punctuation / whitespace.
  s = s.replace(/[\s,;.•·●▪▫◦*]+$/u, "");
  return s.trim();
}
