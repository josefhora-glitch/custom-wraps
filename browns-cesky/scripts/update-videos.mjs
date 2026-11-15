// Videa: nejnovější videa z oficiálních YouTube kanálů (Browns, NFL – filtrováno na Browns).
// Videa se na webu pouze vkládají přes oficiální YouTube přehrávač (youtube-nocookie.com) – zůstávají hostovaná u zdroje.
import { readJson, writeJson, recordStatus, loadConfig, log } from './lib/io.mjs';
import { fetchText } from './lib/http.mjs';
import { parseFeed } from './lib/feeds.mjs';
import { hasClaude, generateJson } from './lib/claude.mjs';

const KEEP = 60;

export function videoCategory(title) {
  const t = title.toLowerCase();
  if (/highlight|every touchdown|top plays|best plays/.test(t)) return 'highlighty';
  if (/press conference|presser|media availability|postgame|post-game|pregame|news conference|speaks|talks/.test(t)) return 'tiskovky';
  if (/mic'd|micd|wired|sound fx|all-access|behind the scenes|hard knocks/.test(t)) return 'zakulisi';
  if (/preview|keys to|what to watch|breakdown|film/.test(t)) return 'analyzy';
  return 'ostatni';
}

async function resolveChannelId(ch, cache) {
  if (ch.channelId) return ch.channelId;
  if (cache[ch.handle]) return cache[ch.handle];
  const { text } = await fetchText(`https://www.youtube.com/@${ch.handle}`, { accept: 'text/html', tries: 2 });
  const id = text.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1] || text.match(/channel\/(UC[\w-]{22})/)?.[1];
  if (!id) throw new Error(`Nelze zjistit ID kanálu @${ch.handle}`);
  cache[ch.handle] = id;
  return id;
}

async function translateTitles(videos) {
  const todo = videos.filter((v) => !v.titleCs);
  if (!todo.length || !hasClaude()) return;
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'titleCs'], properties: { id: { type: 'string' }, titleCs: { type: 'string' } } } } },
  };
  try {
    const { data } = await generateJson({
      prompt: `Přelož názvy videí do přirozené češtiny pro fanoušky NFL (krátce, výstižně, jména hráčů ponech, zavedené termíny NFL ponech anglicky). Nic nepřidávej.\n${todo.map((v) => `${v.id}: ${v.title}`).join('\n')}`,
      schema,
      effort: 'low',
    });
    for (const it of data.items) {
      const v = videos.find((x) => x.id === it.id);
      if (v) v.titleCs = it.titleCs;
    }
  } catch (err) {
    log('videos', `Překlad názvů selhal: ${err.message}`);
  }
}

export async function updateVideos() {
  const cfg = await loadConfig();
  const prev = (await readJson('videos.json', null)) || { items: [] };
  const state = (await readJson('../../state/youtube.json', null)) || {};
  const report = [];
  const fresh = [];
  for (const ch of cfg.videos) {
    try {
      const channelId = await resolveChannelId(ch, state);
      const { text } = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { accept: 'application/atom+xml' });
      let items = parseFeed(text).filter((v) => v.videoId);
      if (ch.filter) items = items.filter((v) => ch.filter.some((k) => `${v.title} ${v.description}`.toLowerCase().includes(k)));
      for (const v of items) {
        fresh.push({
          id: v.videoId,
          title: v.title,
          channel: ch.name,
          official: ch.official,
          publishedAt: v.publishedAt,
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
          category: videoCategory(v.title),
        });
      }
      report.push({ id: ch.id, ok: true, items: items.length });
    } catch (err) {
      report.push({ id: ch.id, ok: false, error: err.message.slice(0, 200) });
    }
  }
  const byId = new Map(prev.items.map((v) => [v.id, v]));
  for (const v of fresh) byId.set(v.id, { ...v, titleCs: byId.get(v.id)?.titleCs || null });
  const items = [...byId.values()].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, KEEP);
  await translateTitles(items);
  const ok = report.some((r) => r.ok);
  if (ok) await writeJson('videos.json', { ...prev, updatedAt: new Date().toISOString(), origin: 'automatika', items });
  await writeJson('../../state/youtube.json', state);
  await recordStatus('videos', { ok, message: ok ? `Videí: ${items.length}` : 'Žádný kanál neodpověděl', details: { channels: report } });
  log('videos', JSON.stringify(report));
  return ok;
}

if (import.meta.url === `file://${process.argv[1]}`) updateVideos().catch((e) => { console.error(e); process.exitCode = 1; });
