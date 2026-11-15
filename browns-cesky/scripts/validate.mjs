// Kontrola datových souborů před publikací (spouští se v CI po aktualizaci).
// Selže-li, workflow nic necommituje ani nenasadí – na webu zůstane poslední dobrý stav.
import { readJson } from './lib/io.mjs';

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

const files = ['status', 'schedule', 'standings', 'stats', 'roster', 'news', 'games', 'videos', 'gallery'];
const data = {};
for (const f of files) {
  data[f] = await readJson(`${f}.json`, undefined);
  need(data[f] !== undefined && data[f] !== null, `${f}.json chybí nebo není platný JSON`);
}
const s = data.schedule;
if (s) {
  need(Array.isArray(s.games) && s.games.length > 0, 'schedule: prázdný rozpis');
  for (const g of s.games || []) {
    need(!Number.isNaN(Date.parse(g.date)), `schedule: zápas ${g.id} má neplatné datum`);
    if (g.status === 'final') need(g.score && Number.isFinite(g.score.browns) && Number.isFinite(g.score.opp), `schedule: zápas ${g.id} bez skóre`);
  }
  const ids = new Set();
  for (const g of s.games || []) { need(!ids.has(g.id), `schedule: duplicitní zápas ${g.id}`); ids.add(g.id); }
}
const n = data.news;
if (n) {
  const ids = new Set();
  for (const it of n.items || []) {
    need(!ids.has(it.id), `news: duplicitní id ${it.id}`); ids.add(it.id);
    need(it.title && it.perex && it.source?.url && it.source?.name, `news: ${it.id} – chybí titulek, perex nebo zdroj`);
    need(!Number.isNaN(Date.parse(it.publishedAt)), `news: ${it.id} – neplatné datum`);
    const words = [it.perex, ...(it.body || []), it.whyItMatters].join(' ').split(/\s+/).length;
    need(words < 450, `news: ${it.id} – text je příliš dlouhý (${words} slov), web má mít krátká shrnutí`);
  }
}
for (const it of data.gallery?.items || []) {
  need(it.credit && (it.license || it.type === 'embed'), `gallery: položka ${it.src || it.url} nemá autora/licenci`);
}
if (problems.length) {
  console.error('Validace dat selhala:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Validace dat OK');
