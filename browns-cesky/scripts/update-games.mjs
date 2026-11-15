// Preview před zápasem a review po zápase. Fakta (skóre, statistiky, body, zranění) se berou
// deterministicky z datového zdroje; Claude z nich pouze píše český redakční text.
import { readJson, writeJson, recordStatus, loadConfig, log } from './lib/io.mjs';
import { getGameSummary } from './lib/espn.mjs';
import { TEAMS, normAbbr, INJURY_STATUS_CS } from './lib/nfl.mjs';
import { hasClaude, generateJson, PREVIEW_SCHEMA, REVIEW_SCHEMA, MODEL } from './lib/claude.mjs';
import { formatPrague, DAY, HOUR } from './lib/time.mjs';

const PREVIEW_WINDOW = 6 * DAY;

function condenseSummary(sum, teamAbbr = 'CLE') {
  const comp = sum.header?.competitions?.[0] || {};
  const teams = (comp.competitors || []).map((c) => ({
    abbr: normAbbr(c.team?.abbreviation),
    homeAway: c.homeAway,
    score: c.score != null ? Number(c.score) : null,
    record: c.record?.[0]?.summary || c.record?.[0]?.displayValue || null,
    quarters: (c.linescores || []).map((l) => Number(l.displayValue ?? l.value)),
  }));
  const box = (sum.boxscore?.teams || []).map((t) => ({
    abbr: normAbbr(t.team?.abbreviation),
    stats: Object.fromEntries((t.statistics || []).map((s) => [s.label || s.name, s.displayValue])),
  }));
  const players = [];
  for (const t of sum.boxscore?.players || []) {
    const abbr = normAbbr(t.team?.abbreviation);
    for (const cat of t.statistics || []) {
      if (!['passing', 'rushing', 'receiving', 'defensive', 'interceptions'].includes(cat.name)) continue;
      for (const a of (cat.athletes || []).slice(0, cat.name === 'defensive' ? 3 : 2)) {
        const line = (cat.labels || []).map((l, i) => `${l} ${a.stats?.[i] ?? ''}`).join(', ');
        players.push({ team: abbr, category: cat.name, name: a.athlete?.displayName, line });
      }
    }
  }
  const scoring = (sum.scoringPlays || []).map((p) => ({
    q: p.period?.number,
    clock: p.clock?.displayValue,
    team: normAbbr(p.team?.abbreviation),
    text: p.text,
    score: `${p.awayScore}-${p.homeScore}`,
  }));
  const injuries = (sum.injuries || []).map((t) => ({
    team: normAbbr(t.team?.abbreviation),
    players: (t.injuries || []).map((i) => ({
      name: i.athlete?.displayName,
      pos: i.athlete?.position?.abbreviation || null,
      status: i.status || null,
      statusCs: INJURY_STATUS_CS[String(i.status || '').toLowerCase()] || i.status || null,
      detail: [i.details?.type, i.details?.detail, i.details?.side].filter(Boolean).join(' ') || null,
    })),
  }));
  const leaders = (sum.leaders || []).map((t) => ({
    team: normAbbr(t.team?.abbreviation),
    leaders: (t.leaders || []).map((c) => ({ category: c.displayName || c.name, name: c.leaders?.[0]?.athlete?.displayName, value: c.leaders?.[0]?.displayValue })),
  }));
  return {
    teams,
    box,
    players,
    scoring,
    injuries,
    leaders,
    venue: sum.gameInfo?.venue ? { name: sum.gameInfo.venue.fullName, city: sum.gameInfo.venue.address?.city, state: sum.gameInfo.venue.address?.state } : null,
    weather: sum.gameInfo?.weather ? { temp: sum.gameInfo.weather.temperature, cond: sum.gameInfo.weather.displayValue } : null,
    attendance: sum.gameInfo?.attendance || null,
    status: comp.status?.type?.detail || null,
    us: teamAbbr,
  };
}

function standingsContext(st) {
  if (!st?.afcNorth?.length) return 'Tabulka není k dispozici.';
  return st.afcNorth.map((r, i) => `${i + 1}. ${r.name} ${r.w}-${r.l}${r.t ? `-${r.t}` : ''}${r.divRecord ? ` (div ${r.divRecord})` : ''}`).join('\n') +
    (st.afc?.length ? `\nAFC seed Browns: ${st.afc.find((r) => r.abbr === 'CLE')?.seed ?? 'neuveden'}` : '');
}

function recentForm(schedule, n = 5) {
  return schedule.games.filter((g) => g.status === 'final').slice(-n).map((g) => `${g.result} ${g.score.browns}:${g.score.opp} ${g.homeAway === 'home' ? 'vs' : '@'} ${g.opponent.abbr}`).join(', ');
}

async function buildPreview(game, schedule, standings, news) {
  let facts = null;
  try {
    facts = condenseSummary(await getGameSummary(game.id));
  } catch (err) {
    log('games', `Summary pro preview nedostupné: ${err.message}`);
  }
  const opp = TEAMS[game.opponent.abbr]?.name || game.opponent.name;
  const relatedNews = news.items.filter((n) => Date.now() - Date.parse(n.publishedAt) < 7 * DAY).slice(0, 12).map((n) => `- [${n.source.name}${n.needsOfficialConfirmation ? ', NEPOTVRZENO' : ''}] ${n.title}: ${n.perex}`).join('\n');
  const base = {
    id: `preview-${game.id}`,
    type: 'preview',
    eventId: game.id,
    gameDate: game.date,
    opponent: game.opponent,
    homeAway: game.homeAway,
    venue: facts?.venue || game.venue,
    broadcast: game.broadcast,
    injuries: facts?.injuries || [],
    records: { browns: schedule.record?.overall, opp: game.opponent.record || facts?.teams?.find((t) => t.abbr === game.opponent.abbr)?.record || null },
    sources: [{ name: 'ESPN – data zápasu', url: game.links?.espn || 'https://www.espn.com/nfl/team/schedule/_/name/cle' }],
    createdAt: new Date().toISOString(),
    origin: 'automatika',
  };
  if (!hasClaude()) return { ...base, title: `Preview: Browns – ${opp}`, textPending: true };
  const prompt = `Připrav preview zápasu Cleveland Browns.
ZÁPAS: ${game.homeAway === 'home' ? `Browns – ${opp}` : `${opp} – Browns`} (${game.homeAway === 'home' ? 'Browns doma' : 'Browns venku'})
TERMÍN (český čas): ${formatPrague(game.date)}
STADION: ${base.venue?.name || 'neuveden'}, ${base.venue?.city || ''}
TV v USA: ${game.broadcast || 'neuvedeno'}
BILANCE: Browns ${base.records.browns || '?'}, ${opp} ${base.records.opp || '?'}
FORMA BROWNS (posledních 5): ${recentForm(schedule) || 'bez dat'}
TABULKA AFC NORTH:
${standingsContext(standings)}
ZRANĚNÍ (ze zdroje dat):
${JSON.stringify(base.injuries)}
NEDÁVNÉ AKTUALITY (už česky shrnuté, se zdroji):
${relatedNews || '(žádné)'}

Nic si nevymýšlej – o soupeři piš jen to, co plyne z podkladu. Chybějící informace uveď v dataGaps.`;
  const { data, model } = await generateJson({ prompt, schema: PREVIEW_SCHEMA, effort: 'medium' });
  return { ...base, ...data, ai: { model, generatedAt: new Date().toISOString() } };
}

async function buildReview(game, schedule, standings) {
  const sum = await getGameSummary(game.id);
  const facts = condenseSummary(sum);
  const opp = TEAMS[game.opponent.abbr]?.name || game.opponent.name;
  const base = {
    id: `review-${game.id}`,
    type: 'review',
    eventId: game.id,
    gameDate: game.date,
    opponent: game.opponent,
    homeAway: game.homeAway,
    venue: facts.venue || game.venue,
    score: game.score,
    result: game.result,
    ot: game.ot,
    quarters: facts.teams,
    box: facts.box,
    players: facts.players.filter((p) => p.team === 'CLE'),
    scoring: facts.scoring,
    sources: [
      { name: 'ESPN – box score', url: game.links?.espn || 'https://www.espn.com/nfl/team/schedule/_/name/cle' },
      { name: 'ClevelandBrowns.com – oficiální report', url: 'https://www.clevelandbrowns.com/news/' },
      { name: 'Highlighty (oficiální YouTube Browns)', url: 'https://www.youtube.com/@clevelandbrowns/videos' },
    ],
    createdAt: new Date().toISOString(),
    origin: 'automatika',
  };
  if (!hasClaude()) return { ...base, title: `Review: Browns – ${opp} ${game.score.browns}:${game.score.opp}`, textPending: true };
  const prompt = `Napiš review zápasu Cleveland Browns.
VÝSLEDEK: Browns ${game.score.browns}, ${opp} ${game.score.opp}${game.ot ? ' po prodloužení' : ''} (${game.result === 'W' ? 'výhra' : game.result === 'L' ? 'prohra' : 'remíza'}), ${game.homeAway === 'home' ? 'doma' : 'venku'}.
DATUM: ${formatPrague(game.date)}
BILANCE BROWNS NYNÍ: ${schedule.record?.overall || '?'}
SKÓRE PO ČTVRTINÁCH: ${JSON.stringify(facts.teams)}
BODOVÉ AKCE: ${JSON.stringify(facts.scoring)}
TÝMOVÉ STATISTIKY: ${JSON.stringify(facts.box)}
HRÁČI: ${JSON.stringify(facts.players)}
TABULKA AFC NORTH (aktuální podle zdroje):
${standingsContext(standings)}

Vycházej jen z těchto dat. Pokud tabulka ještě nezohledňuje výsledek, uveď to v dataGaps.`;
  const { data, model } = await generateJson({ prompt, schema: REVIEW_SCHEMA, effort: 'medium' });
  return { ...base, ...data, ai: { model, generatedAt: new Date().toISOString() } };
}

export async function updateGames({ force = false } = {}) {
  await loadConfig();
  const schedule = await readJson('schedule.json');
  if (!schedule?.games?.length || !schedule.verified) {
    await recordStatus('games', { ok: false, message: 'Rozpis není ověřen z datového zdroje – preview/review se negenerují.' });
    return;
  }
  const standings = await readJson('standings.json');
  const news = (await readJson('news.json')) || { items: [] };
  const store = (await readJson('games.json')) || { items: [] };
  const upsert = (item) => {
    const i = store.items.findIndex((x) => x.id === item.id);
    if (i >= 0) store.items[i] = item;
    else store.items.unshift(item);
  };
  const now = Date.now();
  const done = [];
  const errors = [];

  const next = schedule.games.find((g) => g.status === 'scheduled' && Date.parse(g.date) > now);
  if (next && Date.parse(next.date) - now < PREVIEW_WINDOW) {
    const existing = store.items.find((x) => x.id === `preview-${next.id}`);
    const stale = !existing || existing.textPending || now - Date.parse(existing.createdAt) > 20 * HOUR;
    if (stale || force) {
      try {
        upsert(await buildPreview(next, schedule, standings, news));
        done.push(`preview ${next.opponent.abbr}`);
      } catch (err) {
        errors.push(`preview: ${err.message}`);
      }
    }
  }
  const last = [...schedule.games].reverse().find((g) => g.status === 'final');
  if (last) {
    const existing = store.items.find((x) => x.id === `review-${last.id}`);
    if (!existing || existing.textPending || force) {
      try {
        upsert(await buildReview(last, schedule, standings));
        done.push(`review ${last.opponent.abbr}`);
      } catch (err) {
        errors.push(`review: ${err.message}`);
      }
    }
  }
  store.items.sort((a, b) => b.gameDate.localeCompare(a.gameDate) || (a.type === 'review' ? -1 : 1));
  store.updatedAt = new Date().toISOString();
  await writeJson('games.json', store);
  const msg = `${done.join(', ') || 'beze změn'}${errors.length ? ` | chyby: ${errors.join(' | ')}` : ''}${hasClaude() ? '' : ' | bez API klíče: jen datová část'}`;
  await recordStatus('games', { ok: !errors.length, message: msg, details: { model: hasClaude() ? MODEL : null } });
  log('games', msg);
}

if (import.meta.url === `file://${process.argv[1]}`) updateGames({ force: process.argv.includes('--force') }).catch((e) => { console.error(e); process.exitCode = 1; });
