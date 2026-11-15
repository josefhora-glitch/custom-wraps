import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, findDuplicate, dedupeBatch, titleTokens, jaccard } from '../lib/dedupe.mjs';
import { normalizeEvent, currentSeason } from '../lib/espn.mjs';
import { recordFromGames, recordStr, validateSchedule } from '../update-sports.mjs';
import { inGameWindow } from '../run.mjs';
import { relevanceScore } from '../update-news.mjs';
import { pragueParts } from '../lib/time.mjs';
import { readFile } from 'node:fs/promises';

const cfg = JSON.parse(await readFile(new URL('../../config/sources.json', import.meta.url)));

test('kanonická URL odstraní sledovací parametry a www', () => {
  assert.equal(canonicalUrl('https://www.espn.com/a/b/?utm_source=x&id=5#top'), 'https://espn.com/a/b?id=5');
});

test('duplicita podle podobného titulku', () => {
  const existing = [{ originalTitle: 'Browns place Denzel Ward on injured reserve with hamstring injury', source: { url: 'https://a.com/1' } }];
  const dup = findDuplicate({ title: 'Denzel Ward placed on injured reserve by Browns (hamstring)', url: 'https://b.com/2' }, existing);
  assert.ok(dup);
  assert.equal(findDuplicate({ title: 'Browns sign kicker to practice squad', url: 'https://c.com/3' }, existing), null);
});

test('deduplikace dávky ponechá oficiální zdroj', () => {
  const out = dedupeBatch([
    { title: 'Browns trade for veteran linebacker Smith', url: 'https://espn.com/x', tier: 2, sourceName: 'ESPN' },
    { title: 'Browns acquire veteran linebacker Smith in trade', url: 'https://clevelandbrowns.com/y', tier: 1, sourceName: 'Browns' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, 1);
  assert.equal(out[0].alsoReportedBy[0].name, 'ESPN');
});

test('jaccard je symetrický', () => {
  const a = titleTokens('Browns beat Ravens in overtime'), b = titleTokens('Ravens lose to Browns in overtime thriller');
  assert.equal(jaccard(a, b), jaccard(b, a));
});

const ev = (id, date, us, them, state, home = true) => ({
  id, date, week: { number: 1 }, seasonType: { type: 2 },
  competitions: [{ venue: { fullName: 'Huntington Bank Field', address: { city: 'Cleveland', state: 'OH' } },
    status: { type: { state, completed: state === 'post', shortDetail: state === 'post' ? 'Final/OT' : '' } },
    competitors: [
      { homeAway: home ? 'home' : 'away', team: { id: '5', abbreviation: 'CLE' }, score: us === null ? undefined : { value: us, displayValue: String(us) } },
      { homeAway: home ? 'away' : 'home', team: { id: '33', abbreviation: 'BAL', displayName: 'Baltimore Ravens' }, score: them === null ? undefined : { value: them } },
    ] }],
});

test('normalizace zápasu ESPN – výsledek, OT, domácí', () => {
  const g = normalizeEvent(ev('1', '2026-10-18T17:00Z', 13, 10, 'post'), '5');
  assert.equal(g.result, 'W'); assert.equal(g.ot, true); assert.equal(g.homeAway, 'home');
  assert.deepEqual(g.score, { browns: 13, opp: 10 });
  const s = normalizeEvent(ev('2', '2026-12-27T18:00Z', null, null, 'pre', false), '5');
  assert.equal(s.status, 'scheduled'); assert.equal(s.score, null); assert.equal(s.homeAway, 'away');
});

test('bilance se počítá jen z ukončených zápasů základní části', () => {
  const games = [
    { seasonType: 'REG', status: 'final', result: 'W' }, { seasonType: 'REG', status: 'final', result: 'L' },
    { seasonType: 'REG', status: 'scheduled', result: null }, { seasonType: 'POST', status: 'final', result: 'W' },
  ];
  assert.equal(recordStr(recordFromGames(games)), '1-1');
});

test('validace odhalí ukončený zápas bez skóre', () => {
  const p = validateSchedule({ games: [{ id: 'x', date: '2026-01-01T00:00Z', opponent: { abbr: 'BAL' }, status: 'final', score: null }] });
  assert.equal(p.length, 1);
});

test('herní okno', () => {
  const k = Date.parse('2026-11-15T18:00:00Z');
  const sched = { games: [{ id: 'a', date: '2026-11-15T18:00:00Z', status: 'scheduled' }] };
  assert.ok(inGameWindow(sched, k - HOURS(1)));
  assert.ok(inGameWindow(sched, k + HOURS(4)));
  assert.equal(inGameWindow(sched, k - HOURS(5)), null);
  assert.ok(inGameWindow(sched, k + HOURS(8)), 'neukončený zápas se kontroluje i později');
  assert.equal(inGameWindow({ games: [{ ...sched.games[0], status: 'final' }] }, k + HOURS(8)), null);
});
function HOURS(h) { return h * 3600 * 1000; }

test('relevance zpráv', () => {
  const nfl = cfg.news.find((s) => s.id === 'espn-nfl');
  assert.ok(relevanceScore({ title: 'Browns QB status for Sunday', description: '' }, cfg, nfl) >= 3);
  assert.equal(relevanceScore({ title: 'Guardians sign pitcher', description: 'Cleveland' }, cfg, nfl), 0);
});

test('pražský čas a změna času', () => {
  assert.equal(pragueParts(new Date('2026-07-01T06:00:00Z')).hour, 8); // letní čas
  assert.equal(pragueParts(new Date('2026-12-01T07:00:00Z')).hour, 8); // zimní čas
  assert.equal(currentSeason(new Date('2027-01-20T00:00Z')), 2026);
});
