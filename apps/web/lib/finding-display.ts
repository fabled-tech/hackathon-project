import type { Evidence, Finding } from '@rightsrader/api-client';

const MAX_EXCERPT = 220;
const CHROME_RE =
  /301 Moved Permanently|cloudflare|keyboard.?arrow.?down|Just a moment|official website of the United States|Here’s how you know|Here's how you know|View image at full size|%252F|BeSA02|Search Records|Pre-1978 Records|cocatalog\.loc\.gov|Vessel Hull/i;
const USPTO_DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},\s+20\d{2}\b/g;

function tidyExcerpt(text: string): string {
  const cleaned = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[_*]{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_EXCERPT) return cleaned;
  return `${cleaned.slice(0, MAX_EXCERPT).trim()}…`;
}

export function isChromeExcerpt(text: string): boolean {
  if (CHROME_RE.test(text)) return true;
  return (text.match(USPTO_DATE_RE)?.length ?? 0) > 4;
}

/** Short, judge-readable notes — curated primary first, never raw extract dumps. */
export function linerNotesForFinding(finding: Finding): Evidence[] {
  const primary = finding.evidence?.primary;
  const alternatives = finding.evidence?.alternatives ?? [];
  const curated = primary ? [primary, ...alternatives] : [];
  const pool = curated.length > 0 ? curated : finding.supporting_evidence;
  const usable = pool.filter((item) => item.excerpt && !isChromeExcerpt(item.excerpt));
  if (usable.length === 0) {
    return pool.slice(0, 1).map((item) => ({
      ...item,
      excerpt: 'Extract was mostly page chrome. Open the linked source for the filing.'
    }));
  }
  return usable.slice(0, 2).map((item) => ({ ...item, excerpt: tidyExcerpt(item.excerpt) }));
}
