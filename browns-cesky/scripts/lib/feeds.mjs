// Čtení RSS/Atom a extrakce textu článku (jen pro interní podklad shrnutí – nic se nepublikuje doslovně).
import { XMLParser } from 'fast-xml-parser';
import { fetchFirst, fetchText } from './http.mjs';
import { domainOf } from './dedupe.mjs';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const txt = (x) => (typeof x === 'object' && x !== null ? x['#text'] ?? '' : x ?? '');

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc.rss) {
    return arr(doc.rss.channel?.item).map((it) => ({
      title: stripHtml(txt(it.title)),
      url: txt(it.link) || txt(it.guid),
      publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : null,
      description: stripHtml(txt(it.description)).slice(0, 600),
      sourceTitle: txt(it.source) || null,
      sourceUrl: it.source?.['@url'] || null,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e) => {
      const link = arr(e.link).find((l) => !l['@rel'] || l['@rel'] === 'alternate') || arr(e.link)[0];
      return {
        title: stripHtml(txt(e.title)),
        url: link?.['@href'] || '',
        publishedAt: e.published || e.updated || null,
        description: stripHtml(txt(e.summary) || txt(e['media:group']?.['media:description'])).slice(0, 600),
        videoId: e['yt:videoId'] || null,
        thumbnail: e['media:group']?.['media:thumbnail']?.['@url'] || null,
        author: txt(e.author?.name) || null,
      };
    });
  }
  throw new Error('Neznámý formát feedu');
}

export async function readSource(source) {
  const { url, text } = await fetchFirst(source.urls, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' });
  return { usedUrl: url, items: parseFeed(text) };
}

/** Stáhne stránku článku a vrátí meta údaje + hlavní text (zkrácený). */
export async function extractArticle(url, maxChars = 7000) {
  const { text: html, finalUrl } = await fetchText(url, { tries: 2, timeoutMs: 15000, accept: 'text/html' });
  const meta = (name) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'))?.[1] ||
    null;
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
  const paragraphs = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((p) => p.length > 40 && !/cookie|subscribe|newsletter|all rights reserved|advertis/i.test(p));
  return {
    finalUrl,
    domain: domainOf(finalUrl),
    title: stripHtml(meta('og:title') || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description: stripHtml(meta('og:description') || meta('description') || ''),
    published: meta('article:published_time') || meta('datePublished') || null,
    author: meta('author') || null,
    text: paragraphs.join('\n').slice(0, maxChars),
  };
}
