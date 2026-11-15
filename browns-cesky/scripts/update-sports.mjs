// Aktualizace sportovních dat: rozpis/výsledky, tabulky, týmové statistiky, lídři, soupiska.
// Každá část se aktualizuje samostatně. Selže-li, ponechají se poslední ověřená data
// a do status.json se zapíše chyba – web ji transparentně zobrazí.
import { readJson, writeJson, recordStatus, loadConfig, log } from './lib/io.mjs';
import { getSchedule, getStandings, getTeam, getRoster, getLeaders, getTeamStats, currentSeason, ESPN_SOURCE } from './lib/espn.mjs';
import { TEAMS } from './lib/nfl.mjs';

const pctOf = (r) => (r.w + r.l + r.t ? (r.w + 0.5 * r.t) / (r.w + r.l + r.t) : 0);

export function validateSchedule(sched) {
  const problems = [];
  if (!sched.games.length) problems.push('Rozpis je prázdný.');
  if (sched.games.length > 25) problems.push(`Nečekaně mnoho zápasů (${sched.games.length}).`);
  for (const g of sched.games) {
    if (!g.date || Number.isNaN(Date.parse(g.date))) problems.push(`Zápas ${g.id}: chybí datum.`);
    if (!TEAMS[g.opponent.abbr]) problems.push(`Zápas ${g.id}: neznámý soupeř ${g.opponent.abbr}.`);
    if (g.status === 'final' && !g.score) problems.push(`Zápas ${g.id}: ukončen, ale bez skóre.`);
  }
  return problems;
}

export function recordFromGames(games, seasonType = 'REG') {
  const r = { w: 0, l: 0, t: 0 };
  for (const g of games) {
    if (g.seasonType !== seasonType || g.status !== 'final') continue;
    if (g.result === 'W') r.w++;
    else if (g.result === 'L') r.l++;
    else if (g.result === 'T') r.t++;
  }
  return r;
}
export const recordStr = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

async function updateSchedule(cfg, season) {
  const sched = await getSchedule(cfg.team.espnId, season);
  const problems = validateSchedule(sched);
  if (problems.length) throw new Error(`Validace rozpisu selhala: ${problems.join(' ')}`);

  let team = null;
  try {
    team = await getTeam(cfg.team.espnId);
  } catch (err) {
    log('sports', 'Bilance z endpointu týmu nedostupná:', err.message);
  }
  const computed = recordStr(recordFromGames(sched.games));
  const warnings = [];
  const official = team?.record?.overall || sched.teamRecord;
  if (official && official.replace(/-0$/, '') !== computed) {
    warnings.push(`Bilance ze zdroje (${official}) se liší od bilance spočtené z výsledků (${computed}). Zobrazujeme spočtenou z výsledků.`);
  }
  const out = {
    season,
    updatedAt: new Date().toISOString(),
    source: ESPN_SOURCE,
    origin: 'automatika',
    verified: true,
    record: {
      overall: computed,
      home: team?.record?.home || null,
      away: team?.record?.away || null,
      standingSummary: team?.standingSummary || sched.standingSummary || null,
    },
    byeWeeks: sched.byeWeeks,
    games: sched.games,
    warnings,
  };
  await writeJson('schedule.json', out);
  return { games: sched.games.length, record: computed, warnings };
}

async function updateStandings(season, schedule) {
  const rows = await getStandings(season);
  if (rows.length < 28) throw new Error(`Tabulka obsahuje jen ${rows.length} týmů.`);
  const cle = rows.find((r) => r.abbr === 'CLE');
  if (!cle) throw new Error('V tabulce chybí Browns.');
  const warnings = [];
  if (schedule?.games) {
    const r = recordFromGames(schedule.games);
    if (r.w !== cle.w || r.l !== cle.l) warnings.push(`Bilance Browns v tabulce (${cle.w}-${cle.l}) neodpovídá výsledkům (${r.w}-${r.l}) – tabulka se možná ještě neaktualizovala.`);
  }
  for (const r of rows) if (r.pct === null) r.pct = pctOf(r);
  const bySeedOrPct = (a, b) => (a.seed ?? 99) - (b.seed ?? 99) || b.pct - a.pct;
  const divisions = {};
  for (const r of rows) (divisions[r.division] ||= []).push(r);
  for (const d of Object.values(divisions)) d.sort((a, b) => b.pct - a.pct || (a.seed ?? 99) - (b.seed ?? 99));
  const afc = rows.filter((r) => r.conference === 'AFC').sort(bySeedOrPct);
  await writeJson('standings.json', {
    season,
    updatedAt: new Date().toISOString(),
    source: ESPN_SOURCE,
    origin: 'automatika',
    verified: true,
    afcNorth: divisions['AFC North'] || [],
    divisions,
    afc,
    warnings,
    note: 'Pořadí v konferenci (seed) přebíráme ze zdroje; při shodě bilancí rozhodují oficiální tiebreakery NFL.',
  });
  return { teams: rows.length, warnings };
}

async function updateStats(cfg, season) {
  const [leaders, team] = await Promise.allSettled([getLeaders(cfg.team.espnId, season), getTeamStats(cfg.team.espnId, season)]);
  if (leaders.status === 'rejected' && team.status === 'rejected') throw new Error(`Statistiky nedostupné: ${leaders.reason?.message}`);
  const prev = (await readJson('stats.json', null)) || {};
  const out = {
    season,
    updatedAt: new Date().toISOString(),
    source: ESPN_SOURCE,
    origin: 'automatika',
    verified: true,
    leaders: leaders.status === 'fulfilled' ? leaders.value : prev.leaders || null,
    team: team.status === 'fulfilled' && team.value.length ? team.value : prev.team || [],
    partial: leaders.status === 'rejected' || team.status === 'rejected',
  };
  await writeJson('stats.json', out);
  return { partial: out.partial };
}

async function updateRoster(cfg) {
  const groups = await getRoster(cfg.team.espnId);
  const count = groups.reduce((s, g) => s + g.players.length, 0);
  if (count < 40) throw new Error(`Soupiska má podezřele málo hráčů (${count}).`);
  await writeJson('roster.json', { updatedAt: new Date().toISOString(), source: ESPN_SOURCE, origin: 'automatika', verified: true, groups });
  return { players: count };
}

export async function updateSports({ only } = {}) {
  const cfg = await loadConfig();
  const season = Number(process.env.BROWNS_SEASON) || currentSeason();
  const tasks = [
    ['schedule', () => updateSchedule(cfg, season)],
    ['standings', async () => updateStandings(season, await readJson('schedule.json'))],
    ['stats', () => updateStats(cfg, season)],
    ['roster', () => updateRoster(cfg)],
  ].filter(([k]) => !only || only.includes(k));
  const results = {};
  for (const [name, fn] of tasks) {
    try {
      const details = await fn();
      await recordStatus(name, { ok: true, message: 'Aktualizováno', details });
      log('sports', `${name}: OK`, JSON.stringify(details));
      results[name] = true;
    } catch (err) {
      await recordStatus(name, { ok: false, message: err.message });
      log('sports', `${name}: CHYBA – ${err.message}`);
      results[name] = false;
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  updateSports({ only }).then((r) => {
    if (Object.values(r).every((v) => !v)) process.exitCode = 1;
  });
}
