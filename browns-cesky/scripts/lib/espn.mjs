// Načítání a normalizace sportovních dat z veřejných JSON endpointů ESPN.
// Pozn.: jde o neoficiální, ale široce používané veřejné endpointy. Parsery jsou psané
// defenzivně a každý výstup prochází validací – při nejistotě se data nepřepíšou.
import { fetchJson } from './http.mjs';
import { TEAMS, normAbbr, POSITION_CS } from './nfl.mjs';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';

export const ESPN_SOURCE = { name: 'ESPN (veřejná sportovní data)', url: 'https://www.espn.com/nfl/team/_/name/cle/cleveland-browns' };

const https = (u) => String(u || '').replace(/^http:\/\//, 'https://');
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'object' ? Number(v.value ?? v.displayValue) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Sezóna NFL: do konce února patří k předchozímu roku. */
export function currentSeason(d = new Date()) {
  const y = d.getUTCFullYear();
  return d.getUTCMonth() < 2 ? y - 1 : y;
}

// ---------------------------------------------------------------- rozpis zápasů
export async function getSchedule(teamId, season) {
  const reg = await fetchJson(`${SITE}/teams/${teamId}/schedule?season=${season}&seasontype=2`);
  let post = null;
  try {
    post = await fetchJson(`${SITE}/teams/${teamId}/schedule?season=${season}&seasontype=3`);
  } catch {
    /* playoff rozpis nemusí existovat */
  }
  const events = [...(reg.events || []), ...((post && post.events) || [])];
  const games = events.map((ev) => normalizeEvent(ev, teamId)).filter(Boolean);
  games.sort((a, b) => a.date.localeCompare(b.date));

  // Volný týden = číslo týdne v základní části, které chybí.
  const regWeeks = new Set(games.filter((g) => g.seasonType === 'REG').map((g) => g.week));
  const maxWeek = Math.max(0, ...regWeeks);
  const byeWeeks = [];
  for (let w = 1; w <= maxWeek; w++) if (!regWeeks.has(w)) byeWeeks.push(w);

  return { games, byeWeeks, teamRecord: reg.team?.recordSummary || null, standingSummary: reg.team?.standingSummary || null };
}

function competitorScore(c) {
  if (!c) return null;
  if (c.score === undefined || c.score === null) return null;
  return num(c.score);
}

export function normalizeEvent(ev, teamId) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const us = comp.competitors?.find((c) => String(c.team?.id ?? c.id) === String(teamId));
  const them = comp.competitors?.find((c) => String(c.team?.id ?? c.id) !== String(teamId));
  if (!us || !them) return null;
  const st = comp.status?.type || ev.status?.type || {};
  const state = st.state === 'post' || st.completed ? 'final' : st.state === 'in' ? 'in' : /postpon|cancel/i.test(st.name || '') ? 'postponed' : 'scheduled';
  const ours = competitorScore(us);
  const theirs = competitorScore(them);
  const hasScore = state !== 'scheduled' && ours !== null && theirs !== null;
  let result = null;
  if (state === 'final' && hasScore) result = ours > theirs ? 'W' : ours < theirs ? 'L' : 'T';
  const abbr = normAbbr(them.team?.abbreviation);
  const seasonType = ev.seasonType?.type === 3 || ev.seasonType?.id === '3' ? 'POST' : 'REG';
  return {
    id: String(ev.id),
    week: ev.week?.number ?? null,
    weekLabel: ev.week?.text || (seasonType === 'POST' ? 'Playoff' : null),
    seasonType,
    date: ev.date,
    timeTbd: Boolean(comp.timeValid === false),
    opponent: {
      abbr,
      name: them.team?.displayName || TEAMS[abbr]?.name || abbr,
      record: them.record?.[0]?.displayValue || them.records?.[0]?.summary || null,
    },
    homeAway: us.homeAway === 'home' ? 'home' : 'away',
    neutral: Boolean(comp.neutralSite),
    venue: comp.venue
      ? {
          name: comp.venue.fullName || null,
          city: comp.venue.address?.city || null,
          state: comp.venue.address?.state || null,
          country: comp.venue.address?.country || null,
        }
      : null,
    status: state,
    statusDetail: st.shortDetail || st.detail || null,
    score: hasScore ? { browns: ours, opp: theirs } : null,
    result,
    ot: /OT/.test(st.shortDetail || st.detail || ''),
    broadcast: comp.broadcasts?.[0]?.media?.shortName || comp.broadcasts?.[0]?.names?.[0] || null,
    links: { espn: ev.links?.find((l) => (l.rel || []).includes('summary'))?.href || null },
  };
}

// ---------------------------------------------------------------- tabulky
function statOf(entry, matchers) {
  for (const s of entry.stats || []) {
    for (const m of matchers) {
      const hay = [s.name, s.type, s.abbreviation, s.shortDisplayName, s.displayName].filter(Boolean).join('|');
      if (m instanceof RegExp ? m.test(hay) : s.name === m || s.type === m) return s;
    }
  }
  return null;
}

export async function getStandings(season) {
  const data = await fetchJson(`${STANDINGS}?season=${season}&seasontype=2`);
  const conferences = data.children || [];
  const rows = [];
  for (const conf of conferences) {
    // Některé odpovědi mají konference -> divize -> standings, jiné rovnou konference -> standings.
    const groups = conf.children?.length ? conf.children : [conf];
    for (const g of groups) {
      for (const e of g.standings?.entries || []) {
        const abbr = normAbbr(e.team?.abbreviation);
        const meta = TEAMS[abbr];
        if (!meta) continue;
        const w = num(statOf(e, ['wins']));
        const l = num(statOf(e, ['losses']));
        const t = num(statOf(e, ['ties'])) ?? 0;
        rows.push({
          abbr,
          name: e.team?.displayName || meta.name,
          conference: meta.div.slice(0, 3),
          division: meta.div,
          w,
          l,
          t,
          pct: num(statOf(e, ['winPercent'])),
          pf: num(statOf(e, ['pointsFor'])),
          pa: num(statOf(e, ['pointsAgainst'])),
          diff: num(statOf(e, ['pointDifferential', 'differential'])),
          divRecord: statOf(e, ['vsdiv', /div(ision)?\s*record|vs\.?\s*div/i])?.summary || statOf(e, ['vsdiv'])?.displayValue || null,
          confRecord: statOf(e, ['vsconf', /vs\.?\s*conf/i])?.summary || null,
          home: statOf(e, ['home'])?.summary || null,
          away: statOf(e, ['road', 'away'])?.summary || null,
          streak: statOf(e, ['streak'])?.displayValue || null,
          seed: num(statOf(e, ['playoffSeed'])),
          clincher: statOf(e, ['clincher'])?.displayValue || null,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------- tým: bilance
export async function getTeam(teamId) {
  const data = await fetchJson(`${SITE}/teams/${teamId}`);
  const t = data.team || {};
  const items = t.record?.items || [];
  const pick = (type) => items.find((i) => i.type === type)?.summary || null;
  return {
    record: { overall: pick('total'), home: pick('home'), away: pick('road') },
    standingSummary: t.standingSummary || null,
  };
}

// ---------------------------------------------------------------- soupiska
export async function getRoster(teamId) {
  const data = await fetchJson(`${SITE}/teams/${teamId}/roster`);
  const LABEL = { offense: 'Útok', defense: 'Obrana', specialTeam: 'Speciální týmy', specialteam: 'Speciální týmy' };
  const groups = (data.athletes || []).map((g) => ({
    key: g.position,
    label: LABEL[g.position] || g.position,
    players: (g.items || []).map((p) => ({
      id: String(p.id),
      name: p.fullName || p.displayName,
      jersey: p.jersey ?? null,
      pos: p.position?.abbreviation || null,
      posCs: POSITION_CS[p.position?.abbreviation] || p.position?.displayName || null,
      age: p.age ?? null,
      height: p.displayHeight || null,
      weight: p.displayWeight || null,
      experience: p.experience?.years ?? null,
      college: p.college?.name || null,
      status: p.status?.name || p.status?.type || null,
      injury: p.injuries?.[0]
        ? { status: p.injuries[0].status || null, detail: p.injuries[0].details?.type || p.injuries[0].type?.description || null }
        : null,
    })),
  }));
  return groups;
}

// ---------------------------------------------------------------- statistiky
const athleteCache = new Map();
async function athleteFromRef(ref) {
  const u = https(ref);
  if (!u) return null;
  if (athleteCache.has(u)) return athleteCache.get(u);
  try {
    const a = await fetchJson(u, { tries: 2 });
    const v = { id: String(a.id), name: a.displayName || a.fullName, pos: a.position?.abbreviation || null, jersey: a.jersey || null };
    athleteCache.set(u, v);
    return v;
  } catch {
    return null;
  }
}

const LEADER_CATS = {
  passing: { label: 'Passing (yardy)', names: ['passingYards'] },
  rushing: { label: 'Rushing (yardy)', names: ['rushingYards'] },
  receiving: { label: 'Receiving (yardy)', names: ['receivingYards'] },
  sacks: { label: 'Sacky', names: ['sacks'] },
  tackles: { label: 'Tackly', names: ['totalTackles', 'tackles'] },
  interceptions: { label: 'Interceptions', names: ['interceptions', 'defensiveInterceptions'] },
};

export async function getLeaders(teamId, season) {
  const data = await fetchJson(`${CORE}/seasons/${season}/types/2/teams/${teamId}/leaders`);
  const out = {};
  for (const [key, def] of Object.entries(LEADER_CATS)) {
    const cat = (data.categories || []).find((c) => def.names.includes(c.name));
    const leaders = [];
    for (const l of (cat?.leaders || []).slice(0, 3)) {
      const a = await athleteFromRef(l.athlete?.$ref);
      if (!a) continue;
      leaders.push({ ...a, value: num(l.value), display: l.displayValue || String(l.value ?? '') });
    }
    out[key] = { label: def.label, leaders };
  }
  return out;
}

const TEAM_STATS = [
  { key: 'ppg', label: 'Body na zápas', names: ['totalPointsPerGame', 'pointsPerGame'] },
  { key: 'ypg', label: 'Yardy na zápas', names: ['totalYardsPerGame', 'yardsPerGame', 'netTotalYardsPerGame'] },
  { key: 'passYpg', label: 'Passing yardy na zápas', names: ['netPassingYardsPerGame', 'passingYardsPerGame'] },
  { key: 'rushYpg', label: 'Rushing yardy na zápas', names: ['rushingYardsPerGame'] },
  { key: 'thirdDown', label: 'Úspěšnost 3. downů', names: ['thirdDownConvPct', 'thirdDownConversionPct'] },
  { key: 'turnovers', label: 'Ztráty míče (turnovers)', names: ['totalGiveaways', 'turnovers', 'giveaways'] },
  { key: 'takeaways', label: 'Získané míče (takeaways)', names: ['totalTakeaways', 'takeaways'] },
  { key: 'sacks', label: 'Sacky obrany', names: ['sacks'], category: /defen/i },
  { key: 'ints', label: 'Interceptions obrany', names: ['interceptions'], category: /defensiveInterceptions|defen/i },
  { key: 'penaltyYds', label: 'Trestné yardy', names: ['totalPenaltyYards', 'penaltyYards'] },
];

export async function getTeamStats(teamId, season) {
  const data = await fetchJson(`${CORE}/seasons/${season}/types/2/teams/${teamId}/statistics`);
  const cats = data.splits?.categories || [];
  const out = [];
  for (const def of TEAM_STATS) {
    let found = null;
    for (const c of cats) {
      if (def.category && !def.category.test(c.name || '')) continue;
      found = (c.stats || []).find((s) => def.names.includes(s.name));
      if (found) break;
    }
    if (found) out.push({ key: def.key, label: def.label, value: found.displayValue ?? String(found.value), rank: found.rankDisplayValue || (found.rank ? `${found.rank}.` : null) });
  }
  return out;
}

// ---------------------------------------------------------------- detail zápasu
export async function getGameSummary(eventId) {
  return fetchJson(`${SITE}/summary?event=${eventId}`);
}
