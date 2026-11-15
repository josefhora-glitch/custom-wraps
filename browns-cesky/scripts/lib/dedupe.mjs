// Odstraňování duplicit: kanonická URL + podobnost titulků (Jaccard nad slovy).
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'was',
  'be', 'as', 'after', 'vs', 'v', 'his', 'her', 'their', 'it', 'its', 'this', 'that', 'what', 'how', 'why',
  'cleveland', 'browns', 'nfl', 'week', 'news',
]);

export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|cmpid|ref|src|cid|ocid|partner|taid|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\.|^m\./, '');
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
}

export function domainOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\.|^m\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function titleTokens(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Najde v seznamu existujících položek pravděpodobný duplikát. */
export function findDuplicate(candidate, existing, threshold = 0.5) {
  const cUrl = canonicalUrl(candidate.url);
  const cTok = titleTokens(candidate.title);
  for (const item of existing) {
    const urls = [item.source?.url, ...(item.relatedSources || []).map((s) => s.url), ...(item.seenUrls || [])]
      .filter(Boolean)
      .map(canonicalUrl);
    if (urls.includes(cUrl)) return { item, reason: 'url' };
    const tok = titleTokens(item.originalTitle || item.title);
    if (jaccard(cTok, tok) >= threshold) return { item, reason: 'title' };
  }
  return null;
}

/** Deduplikace v rámci jedné dávky kandidátů – ponechá zdroj s nejvyšší důvěryhodností (nejnižší tier). */
export function dedupeBatch(candidates, threshold = 0.5) {
  const sorted = [...candidates].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9));
  const kept = [];
  for (const c of sorted) {
    const dup = kept.find(
      (k) => canonicalUrl(k.url) === canonicalUrl(c.url) || jaccard(titleTokens(k.title), titleTokens(c.title)) >= threshold,
    );
    if (dup) {
      dup.alsoReportedBy = dup.alsoReportedBy || [];
      if (canonicalUrl(dup.url) !== canonicalUrl(c.url)) dup.alsoReportedBy.push({ name: c.sourceName, url: c.url, tier: c.tier });
    } else kept.push({ ...c });
  }
  return kept;
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}
