// Aktuality: projde důvěryhodné zdroje, vyfiltruje relevantní zprávy o Browns, odstraní duplicity
// a vytvoří vlastní stručná česká shrnutí s odkazem na původní zdroj.
import { readJson, writeJson, recordStatus, loadConfig, log } from './lib/io.mjs';
import { readSource, extractArticle } from './lib/feeds.mjs';
import { canonicalUrl, domainOf, dedupeBatch, findDuplicate, slugify } from './lib/dedupe.mjs';
import { hasClaude, generateJson, NEWS_SCHEMA, MODEL } from './lib/claude.mjs';
import { DAY } from './lib/time.mjs';

const MAX_NEW_PER_RUN = Number(process.env.BROWNS_MAX_NEWS || 8);
const MAX_AGE_MS = 3 * DAY;
const KEEP_ITEMS = 250;

export function relevanceScore(item, cfg, source) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  if (cfg.keywords.exclude.some((k) => hay.includes(k)) && !cfg.keywords.strong.some((k) => hay.includes(k))) return 0;
  let s = 0;
  for (const k of cfg.keywords.strong) if (hay.includes(k)) s += 3;
  for (const k of cfg.keywords.weak) if (hay.includes(k)) s += 1;
  if (!source.requireKeyword) s += 2; // týmový zdroj – vše je o Browns
  return s;
}

export function isSensitive(text, cfg) {
  const t = ` ${String(text).toLowerCase()} `;
  return cfg.sensitiveTopics.some((k) => t.includes(k));
}

function resolveSource(raw, source, cfg) {
  // U agregátoru publikujeme jen zprávy médií z whitelistu.
  if (source.aggregator) {
    const dom = domainOf(raw.sourceUrl || '');
    const trusted = Object.entries(cfg.trustedDomains).find(([d]) => dom === d || dom.endsWith(`.${d}`));
    if (!trusted) return null;
    const title = raw.title.replace(/\s+-\s+[^-]+$/, '');
    return { ...raw, title, sourceName: trusted[1].name, tier: trusted[1].tier, official: Boolean(trusted[1].official), viaAggregator: true };
  }
  return { ...raw, sourceName: source.name, tier: source.tier, official: Boolean(source.official) };
}

async function collectCandidates(cfg, sourceReport) {
  const now = Date.now();
  const all = [];
  for (const source of cfg.news) {
    try {
      const { usedUrl, items } = await readSource(source);
      let accepted = 0;
      for (const raw of items) {
        if (!raw.url || !raw.title) continue;
        const ts = raw.publishedAt ? Date.parse(raw.publishedAt) : NaN;
        if (Number.isFinite(ts) && now - ts > MAX_AGE_MS) continue;
        const resolved = resolveSource(raw, source, cfg);
        if (!resolved) continue;
        const score = relevanceScore(resolved, cfg, source);
        if (score < 3) continue;
        all.push({ ...resolved, score, sourceId: source.id });
        accepted++;
      }
      sourceReport.push({ id: source.id, name: source.name, ok: true, url: usedUrl, items: items.length, relevant: accepted });
    } catch (err) {
      sourceReport.push({ id: source.id, name: source.name, ok: false, error: err.message.slice(0, 300) });
      log('news', `Zdroj ${source.id} selhal: ${err.message}`);
    }
  }
  return all;
}

function newsPrompt(cand, article, recent) {
  return `Podklad pro aktualitu.

ZDROJ: ${cand.sourceName} (${cand.official ? 'OFICIÁLNÍ zdroj' : 'neoficiální médium'})
URL: ${article?.finalUrl || cand.url}
Datum publikace: ${cand.publishedAt || article?.published || 'neuvedeno'}
Původní titulek: ${cand.title}
Perex ze zdroje: ${article?.description || cand.description || '—'}
${cand.alsoReportedBy?.length ? `Totéž hlásí i: ${cand.alsoReportedBy.map((s) => s.name).join(', ')}` : ''}

TEXT ČLÁNKU (pouze podklad, nekopírovat):
"""
${article?.text || '(text článku se nepodařilo načíst – pracuj jen s titulkem a perexem a uveď to v poli unverified)'}
"""

NEDÁVNÉ AKTUALITY NA WEBU (pro rozpoznání duplicity – pokud jde o stejnou událost, vrať její id v duplicateOf):
${recent.map((r) => `- ${r.id}: ${r.title} | orig: ${r.originalTitle || ''}`).join('\n') || '(žádné)'}

Úkol: Posuď relevanci pro fanoušky Browns. Pokud je relevantní a nejde o duplicitu, napiš vlastní stručné české shrnutí podle schématu.`;
}

function makeItem(cand, article, gen, model) {
  const published = cand.publishedAt || article?.published || new Date().toISOString();
  const sensitive = gen.sensitive;
  return {
    id: `${published.slice(0, 10)}-${slugify(gen.titleCs || cand.title)}`,
    type: 'news',
    title: gen.titleCs,
    perex: gen.perex,
    body: gen.whatHappened,
    whyItMatters: gen.whyItMatters,
    unverified: gen.unverified || '',
    category: gen.category,
    tags: gen.tags || [],
    sensitive,
    needsOfficialConfirmation: Boolean(sensitive && !cand.official),
    originalTitle: cand.title,
    source: { name: cand.sourceName, url: article?.finalUrl && !/news\.google\./.test(article.finalUrl) ? article.finalUrl : cand.url, official: cand.official, tier: cand.tier, viaAggregator: Boolean(cand.viaAggregator) },
    relatedSources: (cand.alsoReportedBy || []).map((s) => ({ name: s.name, url: s.url })),
    publishedAt: new Date(published).toISOString(),
    createdAt: new Date().toISOString(),
    image: null, // obrázky jen s ověřeným oprávněním – viz docs/PRAVA-A-MEDIA.md
    origin: 'automatika',
    ai: { model, generatedAt: new Date().toISOString() },
  };
}

export async function updateNews() {
  const cfg = await loadConfig();
  const newsFile = (await readJson('news.json', null)) || { items: [] };
  const queue = (await readJson('../../state/queue.json', null)) || { items: [] };
  const seen = (await readJson('../../state/seen.json', null)) || { urls: {} };
  const sourceReport = [];

  // 1) sběr kandidátů ze zdrojů
  let candidates = await collectCandidates(cfg, sourceReport);
  // 2) přidat nevyřízenou frontu z dřívějška (např. když chyběl API klíč)
  candidates.push(...queue.items);
  // 3) odstranit již viděné a duplicity v dávce
  candidates = candidates.filter((c) => !seen.urls[canonicalUrl(c.url)]);
  candidates = dedupeBatch(candidates).sort((a, b) => a.tier - b.tier || b.score - a.score);

  const recent = newsFile.items.filter((i) => Date.now() - Date.parse(i.publishedAt) < 7 * DAY);
  let created = 0;
  let merged = 0;
  let skipped = 0;
  const remainingQueue = [];
  const errors = [];
  let authFailed = false;

  for (const cand of candidates) {
    const key = canonicalUrl(cand.url);
    // rychlá heuristická duplicita vůči publikovaným položkám
    const dup = findDuplicate(cand, recent);
    if (dup) {
      const it = dup.item;
      it.relatedSources ||= [];
      if (canonicalUrl(it.source.url) !== key && !it.relatedSources.some((s) => canonicalUrl(s.url) === key)) {
        it.relatedSources.push({ name: cand.sourceName, url: cand.url });
        // Oficiální potvrzení citlivé zprávy
        if (cand.official && it.needsOfficialConfirmation) {
          it.needsOfficialConfirmation = false;
          it.officialConfirmation = { name: cand.sourceName, url: cand.url, at: new Date().toISOString() };
        }
      }
      seen.urls[key] = Date.now();
      merged++;
      continue;
    }
    if (!hasClaude() || authFailed || created >= MAX_NEW_PER_RUN) {
      remainingQueue.push(cand);
      continue;
    }
    let article = null;
    try {
      article = await extractArticle(cand.url);
    } catch (err) {
      log('news', `Článek nelze načíst (${cand.url}): ${err.message}`);
    }
    try {
      const { data: gen, model } = await generateJson({ prompt: newsPrompt(cand, article, recent), schema: NEWS_SCHEMA, effort: 'medium' });
      seen.urls[key] = Date.now();
      if (!gen.relevant) {
        skipped++;
        continue;
      }
      const target = gen.duplicateOf && recent.find((r) => r.id === gen.duplicateOf);
      if (target) {
        target.relatedSources ||= [];
        target.relatedSources.push({ name: cand.sourceName, url: cand.url });
        merged++;
        continue;
      }
      const item = makeItem(cand, article, gen, model);
      if (newsFile.items.some((i) => i.id === item.id)) item.id += `-${created + 1}`;
      newsFile.items.unshift(item);
      recent.unshift(item);
      created++;
    } catch (err) {
      remainingQueue.push(cand);
      if (err.status === 401 || err.status === 403 || /authentication_error|invalid x-api-key/i.test(err.message)) {
        authFailed = true;
        errors.push('Neplatný ANTHROPIC_API_KEY (Claude API klíč odmítlo) – zkontrolujte secret v nastavení GitHubu.');
      } else errors.push(`${cand.title.slice(0, 60)}: ${err.message.slice(0, 200)}`);
    }
  }

  // úklid
  const cutoff = Date.now() - 30 * DAY;
  for (const [k, ts] of Object.entries(seen.urls)) if (ts < cutoff) delete seen.urls[k];
  newsFile.items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  newsFile.items = newsFile.items.slice(0, KEEP_ITEMS);
  newsFile.updatedAt = new Date().toISOString();

  await writeJson('news.json', newsFile);
  await writeJson('../../state/queue.json', { updatedAt: new Date().toISOString(), items: remainingQueue.slice(0, 60) });
  await writeJson('../../state/seen.json', seen);

  const okSources = sourceReport.filter((s) => s.ok).length;
  const ok = okSources > 0 && errors.length === 0;
  let message = `Nové: ${created}, sloučené duplicity: ${merged}, nerelevantní: ${skipped}, ve frontě: ${remainingQueue.length}. Funkční zdroje ${okSources}/${sourceReport.length}.`;
  if (!hasClaude()) message += ' Chybí ANTHROPIC_API_KEY – česká shrnutí se negenerují, zprávy čekají ve frontě.';
  if (errors.length) message += ` Chyby: ${errors.slice(0, 3).join(' | ')}`;
  await recordStatus('news', { ok: ok && hasClaude(), message, details: { sources: sourceReport, model: hasClaude() ? MODEL : null } });
  log('news', message);
  return { created, merged };
}

if (import.meta.url === `file://${process.argv[1]}`) updateNews().catch((e) => { console.error(e); process.exitCode = 1; });
