/* Cleveland Browns Česky – klientská aplikace (bez frameworku).
   Data se čtou z data/*.json, které připravuje automatika (scripts/). Vše se zobrazuje v čase Europe/Prague.
   Zásada: pokud data nejsou čerstvá nebo ověřená, web to vždy viditelně řekne. */
(function () {
  'use strict';

  var TZ = 'Europe/Prague';
  var HOUR = 3600 * 1000;
  var DATASETS = ['status', 'schedule', 'standings', 'stats', 'roster', 'news', 'games', 'videos', 'gallery'];
  var D = {};
  var timers = [];
  // Ve sdíleném náhledu (claude.ai) nejsou povolené vložené rámce třetích stran – videa se pak jen odkazují.
  var EMBEDS = !/claude|anthropic/.test(location.hostname);

  var TEAMS = {
    BAL: ['Baltimore Ravens', '#241773'], CIN: ['Cincinnati Bengals', '#fb4f14'], CLE: ['Cleveland Browns', '#ff3c00'], PIT: ['Pittsburgh Steelers', '#c99400'],
    BUF: ['Buffalo Bills', '#00338d'], MIA: ['Miami Dolphins', '#008e97'], NE: ['New England Patriots', '#002244'], NYJ: ['New York Jets', '#125740'],
    HOU: ['Houston Texans', '#03202f'], IND: ['Indianapolis Colts', '#002c5f'], JAX: ['Jacksonville Jaguars', '#006778'], TEN: ['Tennessee Titans', '#4b92db'],
    DEN: ['Denver Broncos', '#fb4f14'], KC: ['Kansas City Chiefs', '#e31837'], LV: ['Las Vegas Raiders', '#5f6366'], LAC: ['Los Angeles Chargers', '#0080c6'],
    CHI: ['Chicago Bears', '#0b162a'], DET: ['Detroit Lions', '#0076b6'], GB: ['Green Bay Packers', '#203731'], MIN: ['Minnesota Vikings', '#4f2683'],
    DAL: ['Dallas Cowboys', '#003594'], NYG: ['New York Giants', '#0b2265'], PHI: ['Philadelphia Eagles', '#004c54'], WSH: ['Washington Commanders', '#5a1414'],
    ATL: ['Atlanta Falcons', '#a71930'], CAR: ['Carolina Panthers', '#0085ca'], NO: ['New Orleans Saints', '#9a8255'], TB: ['Tampa Bay Buccaneers', '#d50a0a'],
    ARI: ['Arizona Cardinals', '#97233f'], LAR: ['Los Angeles Rams', '#003594'], SF: ['San Francisco 49ers', '#aa0000'], SEA: ['Seattle Seahawks', '#002244']
  };
  var CATEGORIES = {
    zapasy: 'Zápasy', zraneni: 'Zranění', soupiska: 'Soupiska', trejdy: 'Trejdy', treneri: 'Trenéři', draft: 'Draft',
    smlouvy: 'Smlouvy', tabulka: 'Tabulka', klub: 'Klub', ostatni: 'Ostatní'
  };
  var VIDEO_CATS = { highlighty: 'Highlighty', tiskovky: 'Tiskové konference', zakulisi: 'Zákulisí', analyzy: 'Analýzy', ostatni: 'Ostatní' };
  var TASK_LABELS = {
    schedule: 'Výsledky a rozpis', standings: 'Tabulky', stats: 'Statistiky', roster: 'Soupiska',
    news: 'Aktuality (zdroje + česká shrnutí)', videos: 'Videa', games: 'Preview a review zápasů'
  };
  // Po kolika hodinách bez úspěšné aktualizace považujeme data za možná neaktuální.
  var STALE_H = { schedule: 26, standings: 26, stats: 26, roster: 50, news: 26, videos: 26, games: 50 };

  // --------------------------------------------------------------------- pomocníci
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(iso, opts) {
    if (!iso) return '—';
    var o = Object.assign({ timeZone: TZ }, opts);
    return new Intl.DateTimeFormat('cs-CZ', o).format(new Date(iso));
  }
  var fDateTime = function (iso) { return fmt(iso, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  var fDay = function (iso) { return fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }); };
  var fShort = function (iso) { return fmt(iso, { day: 'numeric', month: 'numeric' }); };
  var fTime = function (iso) { return fmt(iso, { hour: '2-digit', minute: '2-digit' }); };
  function rel(iso) {
    if (!iso) return '';
    var diff = Date.now() - Date.parse(iso);
    var m = Math.round(diff / 60000);
    if (m < 1) return 'právě teď';
    if (m < 60) return 'před ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return 'před ' + h + ' h';
    var d = Math.round(h / 24);
    return d === 1 ? 'včera' : 'před ' + d + ' dny';
  }
  function teamName(abbr) { return (TEAMS[abbr] || [abbr])[0]; }
  function badge(abbr, sm) {
    var t = TEAMS[abbr] || [abbr, '#666'];
    var cls = 'badge' + (sm ? ' badge--sm' : '') + (abbr === 'CLE' ? ' badge--browns' : '');
    return '<span class="' + cls + '" style="--team:' + t[1] + '" aria-hidden="true">' + esc(abbr) + '</span>';
  }
  function rec(r) { return r ? r.w + '-' + r.l + (r.t ? '-' + r.t : '') : '—'; }
  function venueStr(v) { return v ? [v.name, v.city].filter(Boolean).join(', ') : 'místo neuvedeno'; }

  // --------------------------------------------------------------------- čerstvost a zdroje dat
  function freshness(key, data, opts) {
    opts = opts || {};
    var task = (D.status && D.status.tasks && D.status.tasks[key]) || {};
    var parts = [];
    var updated = (data && data.updatedAt) || task.lastSuccessAt;
    if ((data && data.origin === 'pocatecni-naplneni') || (task.origin === 'pocatecni-naplneni' && !task.lastSuccessAt)) {
      parts.push('<span class="chip chip--warn">Počáteční data · neověřeno datovým zdrojem</span>');
    } else if (task.ok === false) {
      parts.push('<span class="chip chip--bad">Poslední aktualizace selhala ' + esc(rel(task.lastAttemptAt)) + '</span>');
    } else if (updated && Date.now() - Date.parse(updated) > (STALE_H[key] || 26) * HOUR) {
      parts.push('<span class="chip chip--warn">Data mohou být neaktuální</span>');
    } else if (updated) {
      parts.push('<span class="chip chip--ok">Aktuální</span>');
    }
    parts.push('<span>Aktualizováno ' + (updated ? esc(fDateTime(updated)) : 'zatím nikdy') + '</span>');
    var src = data && (data.source || (data.sources && data.sources[0]));
    if (src && !opts.noSource) parts.push('<span>Zdroj: <a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.name) + '</a>' + (data.sources && data.sources.length > 1 ? ' a další' : '') + '</span>');
    return '<div class="fresh">' + parts.join('') + '</div>';
  }
  function dataNotice(data, task) {
    var out = '';
    if (data && data.note) out += '<div class="notice notice--info">' + esc(data.note) + '</div>';
    (data && data.warnings || []).forEach(function (w) { out += '<div class="notice"><strong>Kontrola dat</strong>' + esc(w) + '</div>'; });
    var t = D.status && D.status.tasks && D.status.tasks[task];
    if (t && t.ok === false && data && data.origin !== 'pocatecni-naplneni') {
      out += '<div class="notice notice--bad"><strong>Aktualizace se nezdařila</strong>Zobrazujeme poslední úspěšně načtená data' +
        (t.lastSuccessAt ? ' z ' + esc(fDateTime(t.lastSuccessAt)) : '') + '. Důvod: ' + esc(t.message) + '</div>';
    }
    return out;
  }

  // --------------------------------------------------------------------- data
  function load() {
    var bust = EMBEDS ? '?t=' + Math.floor(Date.now() / 60000) : '';
    return Promise.all(DATASETS.map(function (k) {
      return fetch('data/' + k + '.json' + bust, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { D[k] = j; })
        .catch(function () { D[k] = null; D._failed = (D._failed || []).concat(k); });
    }));
  }
  function games() { return (D.schedule && D.schedule.games) || []; }
  function nextGame() {
    var now = Date.now();
    return games().filter(function (g) { return g.status !== 'final' && Date.parse(g.date) > now - 4.5 * HOUR; })[0] || null;
  }
  function lastGame() { var f = games().filter(function (g) { return g.status === 'final'; }); return f[f.length - 1] || null; }
  function gameItem(type, g) {
    var items = (D.games && D.games.items) || [];
    return items.filter(function (i) { return i.type === type && i.eventId === g.id; })[0] || null;
  }
  function newsItems() { return ((D.news && D.news.items) || []).slice().sort(function (a, b) { return b.publishedAt.localeCompare(a.publishedAt); }); }

  // --------------------------------------------------------------------- komponenty
  function countdownHtml(iso) {
    return '<div class="countdown" data-countdown="' + esc(iso) + '" role="timer" aria-label="Odpočet do výkopu">' +
      ['dní', 'hod', 'min', 'sek'].map(function (u) { return '<div class="countdown__cell"><span class="countdown__n">–</span><span class="countdown__u">' + u + '</span></div>'; }).join('') + '</div>';
  }
  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var diff = Date.parse(el.getAttribute('data-countdown')) - Date.now();
      var cells = el.querySelectorAll('.countdown__n');
      if (diff <= 0) { el.outerHTML = '<p class="hero__label" style="text-align:center">Výkop proběhl – výsledek doplní automatika</p>'; return; }
      var s = Math.floor(diff / 1000);
      var vals = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
      vals.forEach(function (v, i) { cells[i].textContent = String(v).padStart(i ? 2 : 1, '0'); });
    });
  }

  function heroNext() {
    var g = nextGame();
    if (!g) {
      return '<section class="hero"><div class="hero__top"><span class="hero__label">Příští zápas</span></div>' +
        '<p>Další zápas zatím není v rozpisu. ' + (D.schedule ? '' : 'Rozpis se nepodařilo načíst.') + '</p>' + freshness('schedule', D.schedule) + '</section>';
    }
    var home = g.homeAway === 'home';
    var left = home ? g.opponent.abbr : 'CLE';
    var right = home ? 'CLE' : g.opponent.abbr;
    var started = Date.parse(g.date) <= Date.now();
    var preview = gameItem('preview', g);
    var sideHtml = function (abbr) {
      var meta = abbr === 'CLE' ? (D.schedule.record && D.schedule.record.overall) : g.opponent.record;
      return '<div class="side">' + badge(abbr) + '<span class="side__name">' + esc(TEAMS[abbr] ? teamName(abbr).split(' ').slice(-1)[0] : abbr) + '</span>' +
        '<span class="side__meta">' + esc(teamName(abbr)) + (meta ? ' · ' + esc(meta) : '') + '</span></div>';
    };
    var today = fmt(g.date, { day: 'numeric', month: 'numeric', year: 'numeric' }) === fmt(new Date().toISOString(), { day: 'numeric', month: 'numeric', year: 'numeric' });
    return '<section class="hero" aria-labelledby="next-h">' +
      '<div class="hero__top"><span class="hero__label" id="next-h">' + (today ? 'Dnes hrajeme' : 'Příští zápas') + '</span>' +
      '<span class="chip chip--info">' + esc(g.weekLabel || (g.week ? 'Týden ' + g.week : '')) + (g.broadcast ? ' · TV v USA: ' + esc(g.broadcast) : '') + '</span></div>' +
      '<div class="matchup">' + sideHtml(left) + '<span class="vs" aria-label="hostí">@</span>' + sideHtml(right) + '</div>' +
      '<div class="hero__when"><span class="hero__date">' + esc(fDay(g.date)) + (g.timeTbd ? '' : ' · ' + esc(fTime(g.date))) + '</span>' +
      '<span class="hero__place">' + (g.timeTbd ? 'Čas výkopu zatím nepotvrzen · ' : 'Český čas · ') + esc(venueStr(g.venue)) + (home ? ' (Browns doma)' : ' (Browns venku)') + '</span></div>' +
      (started ? '<p class="hero__label" style="text-align:center">' + (g.status === 'in' ? 'Zápas probíhá' + (g.score ? ' · ' + g.score.browns + ':' + g.score.opp + ' pro ' + (g.score.browns >= g.score.opp ? 'Browns' : 'soupeře') : '') : 'Výkop proběhl – výsledek doplní automatika') + '</p>' : countdownHtml(g.date)) +
      '<div class="hero__actions">' + (preview ? '<a class="btn btn--primary" href="#z-' + esc(preview.id) + '">Preview zápasu</a>' : '') +
      '<a class="btn btn--ghost" href="#kalendar">Celý kalendář</a></div>' +
      freshness('schedule', D.schedule) + '</section>';
  }

  function scoreboard(g, withLink) {
    var home = g.homeAway === 'home';
    var rows = [
      { abbr: 'CLE', pts: g.score.browns, lost: g.result === 'L' },
      { abbr: g.opponent.abbr, pts: g.score.opp, lost: g.result === 'W' }
    ];
    if (home) rows.reverse();
    var review = gameItem('review', g);
    return '<article class="scoreboard">' +
      '<div class="scoreboard__head"><span>' + esc(g.weekLabel || ('Týden ' + g.week)) + ' · ' + esc(fmt(g.date, { day: 'numeric', month: 'long', year: 'numeric' })) + '</span>' +
      '<span class="result-pill result-pill--' + g.result + '">' + ({ W: 'VÝHRA', L: 'PROHRA', T: 'REMÍZA' }[g.result]) + (g.ot ? ' PO PRODL.' : '') + '</span></div>' +
      '<div class="scoreboard__body">' + rows.map(function (r) {
        return '<div class="score-row' + (r.lost ? ' score-row--lost' : '') + '">' + badge(r.abbr, true) + '<span class="score-row__name">' + esc(teamName(r.abbr)) + '</span><span class="score-row__pts score">' + r.pts + '</span></div>';
      }).join('') +
      '<p class="table-note">' + esc(venueStr(g.venue)) + (g.note ? ' · ' + esc(g.note) : (g.ot ? ' · rozhodlo prodloužení' : '')) + '</p>' +
      (review && review.perex ? '<p>' + esc(review.perex) + '</p>' : '') +
      (withLink && review ? '<a class="more" href="#z-' + esc(review.id) + '">Celé review</a>' : '') +
      (!review && withLink ? '<p class="table-note">Review zápasu připraví automatika po načtení box score.</p>' : '') +
      '</div></article>';
  }

  function recordBlock() {
    var s = D.schedule;
    if (!s) return '';
    var st = D.standings && D.standings.afcNorth;
    var pos = st ? st.findIndex(function (r) { return r.abbr === 'CLE'; }) + 1 : 0;
    return '<div class="record">' +
      '<div><span class="record__v num">' + esc(s.record.overall || '—') + '</span><span class="record__k">Bilance</span></div>' +
      '<div><span class="record__v num">' + (pos ? pos + '.' : '—') + '</span><span class="record__k">AFC North</span></div>' +
      '<div><span class="record__v num">' + esc((D.standings && D.standings.afc && (D.standings.afc.find(function (r) { return r.abbr === 'CLE'; }) || {}).seed) || '—') + '</span><span class="record__k">Seed v AFC</span></div>' +
      '</div>';
  }

  function weeksStrip() {
    var gs = games().filter(function (g) { return g.seasonType === 'REG'; });
    if (!gs.length) return '';
    var nx = nextGame();
    var byWeek = {};
    gs.forEach(function (g) { byWeek[g.week] = g; });
    var max = Math.max.apply(null, gs.map(function (g) { return g.week; }));
    var cells = [];
    for (var w = 1; w <= max; w++) {
      var g = byWeek[w];
      if (!g) { cells.push('<div class="week week--bye"><span class="week__n">T' + w + '</span><span class="week__opp">VOLNO</span><span class="week__res">bye</span></div>'); continue; }
      var cls = 'week' + (g.result ? ' week--' + g.result : '') + (nx && nx.id === g.id ? ' week--next' : '');
      var res = g.score ? g.result + ' ' + g.score.browns + ':' + g.score.opp : fShort(g.date);
      cells.push('<a class="' + cls + '" href="#kalendar" title="' + esc((g.homeAway === 'home' ? 'vs ' : '@ ') + teamName(g.opponent.abbr)) + '"><span class="week__n">T' + w + '</span><span class="week__opp">' + (g.homeAway === 'home' ? '' : '@') + esc(g.opponent.abbr) + '</span><span class="week__res">' + esc(res) + '</span></a>');
    }
    return '<div class="weeks">' + cells.join('') + '</div>';
  }

  function standingsTable(rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<div class="notice notice--info">Tabulka zatím není k dispozici.</div>';
    var full = opts.full;
    return '<div class="table-wrap"><table><thead><tr>' + (opts.seed ? '<th class="r">Seed</th>' : '<th class="r">#</th>') + '<th>Tým</th><th class="r">V</th><th class="r">P</th><th class="r">R</th><th class="r">%</th>' +
      (full ? '<th class="r">Div.</th><th class="r">Body +</th><th class="r">Body −</th><th>Série</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr' + (r.abbr === 'CLE' ? ' class="is-browns"' : '') + '><td class="r">' + (opts.seed ? (r.seed || '—') : i + 1) + '</td><td><span class="team-cell">' + badge(r.abbr, true) + esc(full ? r.name : teamName(r.abbr).split(' ').slice(-1)[0]) + '</span></td>' +
          '<td class="r">' + (r.w != null ? r.w : '—') + '</td><td class="r">' + (r.l != null ? r.l : '—') + '</td><td class="r">' + (r.t || 0) + '</td><td class="r">' + (r.pct != null ? r.pct.toFixed(3).replace(/^0/, '') : '—') + '</td>' +
          (full ? '<td class="r">' + esc(r.divRecord || '—') + '</td><td class="r">' + (r.pf != null ? r.pf : '—') + '</td><td class="r">' + (r.pa != null ? r.pa : '—') + '</td><td>' + esc(r.streak || '—') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function newsRow(n, lead) {
    return '<a class="news-item' + (lead ? ' news-item--lead' : '') + '" href="#a-' + esc(n.id) + '">' +
      '<span class="news-item__meta"><span class="cat">' + esc(CATEGORIES[n.category] || n.category) + '</span>' +
      '<span>' + esc(n.sourceDateUnknown ? fDateTime(n.publishedAt) : fDateTime(n.publishedAt)) + '</span><span>' + esc(n.source.name) + '</span>' +
      (n.source.official ? '<span class="chip chip--official">Oficiální zdroj</span>' : '') +
      (n.needsOfficialConfirmation ? '<span class="chip chip--warn">Nepotvrzeno oficiálně</span>' : '') + '</span>' +
      '<span class="news-item__title">' + esc(n.title) + '</span>' +
      '<span class="news-item__perex">' + esc(n.perex) + '</span></a>';
  }

  function leadersBlock(limitCats) {
    var st = D.stats;
    if (!st || !st.leaders) {
      return '<div class="notice notice--info"><strong>Statistiky hráčů zatím nejsou načtené</strong>' + esc((st && st.note) || 'Zobrazí se po prvním úspěšném běhu automatiky.') + '</div>';
    }
    var keys = limitCats || ['passing', 'rushing', 'receiving', 'sacks', 'tackles', 'interceptions'];
    return '<div class="leaders">' + keys.map(function (k) {
      var c = st.leaders[k];
      if (!c || !c.leaders || !c.leaders.length) return '<div class="leader"><span class="leader__cat">' + esc(c ? c.label : k) + '</span><span class="table-note">Bez dat</span></div>';
      var top = c.leaders[0];
      return '<div class="leader"><span class="leader__cat">' + esc(c.label) + '</span><div class="leader__top"><span class="leader__name">' + esc(top.name) + ' <small class="table-note">' + esc(top.pos || '') + '</small></span><span class="leader__val num">' + esc(top.display) + '</span></div>' +
        (c.leaders.length > 1 ? '<ol start="2">' + c.leaders.slice(1).map(function (l) { return '<li>' + esc(l.name) + ' – ' + esc(l.display) + '</li>'; }).join('') + '</ol>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function latestGameCard() {
    var items = ((D.games && D.games.items) || []).slice().sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var it = items[0];
    if (!it) return '<div class="notice notice--info">Preview ani review zatím nejsou k dispozici.</div>';
    return gameCard(it);
  }
  function gameCard(it) {
    var kicker = it.type === 'preview' ? 'Preview' : 'Review';
    return '<a class="card" href="#z-' + esc(it.id) + '"><span class="card__kicker">' + kicker + ' · ' + esc(fmt(it.gameDate, { day: 'numeric', month: 'long' })) + '</span>' +
      '<span class="card__title">' + esc(it.title) + '</span>' + (it.perex ? '<span class="card__text">' + esc(it.perex) + '</span>' : '') +
      (it.textPending ? '<span class="chip chip--warn">Text se připravuje – zatím jen data</span>' : '') +
      (it.origin === 'pocatecni-naplneni' ? '<span class="chip chip--warn">Redakční počáteční text</span>' : '') + '</a>';
  }

  // --------------------------------------------------------------------- stránky
  var views = {};

  views.home = function () {
    var news = newsItems();
    var last = lastGame();
    var html = '';
    html += heroNext();
    html += '<div class="grid-2"><div class="stack">';
    html += '<section class="section"><div class="section__head"><h2>Hlavní zprávy</h2><a class="more" href="#aktuality">Všechny aktuality</a></div>' +
      (news.length ? '<div class="news-list">' + news.slice(0, 4).map(function (n, i) { return newsRow(n, i === 0); }).join('') + '</div>' : '<div class="notice notice--info">Zatím žádné aktuality.</div>') +
      freshness('news', D.news, { noSource: true }) + '</section>';
    html += '<section class="section"><div class="section__head"><h2>Preview a review</h2><a class="more" href="#zapasy">Všechny zápasy</a></div>' + latestGameCard() + '</section>';
    html += '<section class="section"><div class="section__head"><h2>Lídři Browns</h2><a class="more" href="#statistiky">Statistiky</a></div>' + leadersBlock(['passing', 'rushing', 'receiving', 'sacks']) + freshness('stats', D.stats) + '</section>';
    html += '</div><div class="stack">';
    html += '<section class="section"><div class="section__head"><h2>Poslední zápas</h2></div>' + (last ? scoreboard(last, true) : '<div class="notice notice--info">Sezóna ještě nezačala.</div>') + '</section>';
    html += '<section class="section"><div class="section__head"><h2>Bilance ' + esc(D.schedule ? D.schedule.season : '') + '</h2></div>' + recordBlock() + '</section>';
    html += '<section class="section"><div class="section__head"><h2>AFC North</h2><a class="more" href="#tabulky">Tabulky</a></div>' + standingsTable(D.standings && D.standings.afcNorth) +
      (D.standings && D.standings.note ? '<p class="table-note">' + esc(D.standings.note) + '</p>' : '') + freshness('standings', D.standings) + '</section>';
    html += '</div></div>';
    html += '<section class="section"><div class="section__head"><h2>Sezóna týden po týdnu</h2><a class="more" href="#kalendar">Kalendář</a></div>' + weeksStrip() + '</section>';
    html += '<section class="section"><div class="section__head"><h2>Rychlé odkazy</h2></div><div class="quick">' +
      [['#soupiska', 'Soupiska', 'hráči a pozice'], ['#tabulky', 'Tabulky', 'AFC North a AFC'], ['#kalendar', 'Kalendář', 'časy v českém čase'], ['#aktuality', 'Články', 'aktuality česky'], ['#videa', 'Videa', 'highlighty a tiskovky'], ['#galerie', 'Galerie', 'fotky a příspěvky']]
        .map(function (q) { return '<a href="' + q[0] + '">' + q[1] + '<span>' + q[2] + '</span></a>'; }).join('') + '</div></section>';
    return html;
  };

  views.aktuality = function (param) {
    var items = newsItems();
    var cat = param || 'vse';
    var cats = ['vse'].concat(Object.keys(CATEGORIES).filter(function (c) { return items.some(function (n) { return n.category === c; }); }));
    var shown = cat === 'vse' ? items : items.filter(function (n) { return n.category === cat; });
    return '<div class="page-head"><span class="eyebrow">Aktuality</span><h1>Zprávy o Browns česky</h1>' +
      '<p class="lead">Krátká česká redakční shrnutí s odkazem na původní zdroj. Citlivé zprávy (zranění, trejdy, změny trenérů) bez oficiálního potvrzení jsou označené.</p>' + freshness('news', D.news, { noSource: true }) + '</div>' +
      dataNotice(null, 'news') +
      '<div class="filters" role="toolbar" aria-label="Kategorie">' + cats.map(function (c) {
        return '<button class="btn btn--line" data-filter="' + c + '" aria-pressed="' + (c === cat) + '">' + esc(c === 'vse' ? 'Vše' : CATEGORIES[c]) + '</button>';
      }).join('') + '</div>' +
      '<div class="news-list" id="news-list">' + (shown.length ? shown.map(function (n) { return newsRow(n); }).join('') : '<div class="notice notice--info">V této kategorii zatím nic není.</div>') + '</div>';
  };

  views.article = function (id) {
    var n = newsItems().filter(function (x) { return x.id === id; })[0];
    if (!n) return notFound('Aktualita nebyla nalezena.');
    return '<a class="back" href="#aktuality">Zpět na aktuality</a><article class="article">' +
      '<span class="news-item__meta"><span class="cat">' + esc(CATEGORIES[n.category] || n.category) + '</span><span>Publikováno ' + esc(fDateTime(n.publishedAt)) + '</span>' +
      (n.source.official ? '<span class="chip chip--official">Oficiální zdroj</span>' : '') + (n.needsOfficialConfirmation ? '<span class="chip chip--warn">Nepotvrzeno oficiálně</span>' : '') +
      (n.officialConfirmation ? '<span class="chip chip--ok">Potvrzeno: ' + esc(n.officialConfirmation.name) + '</span>' : '') + '</span>' +
      '<h1>' + esc(n.title) + '</h1><p class="article__perex">' + esc(n.perex) + '</p>' +
      (n.image ? '<figure><img src="' + esc(n.image.url) + '" alt="' + esc(n.image.alt || '') + '"><figcaption class="table-note">Foto: ' + esc(n.image.credit) + '</figcaption></figure>' : '') +
      '<div class="callout"><h3>Co se stalo</h3><div class="article__body">' + (n.body || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></div>' +
      '<div class="callout"><h3>Proč je to důležité pro Browns</h3><p>' + esc(n.whyItMatters) + '</p></div>' +
      (n.unverified ? '<div class="notice"><strong>Co zatím není ověřeno</strong>' + esc(n.unverified) + '</div>' : '') +
      '<div class="source-box"><strong>Původní zdroj</strong><p><a href="' + esc(n.source.url) + '" target="_blank" rel="noopener">' + esc(n.source.name) + (n.originalTitle ? ': „' + esc(n.originalTitle) + '“' : '') + '</a></p>' +
      ((n.relatedSources || []).length ? '<strong>Další zdroje ke zprávě</strong><ul>' + n.relatedSources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></li>'; }).join('') + '</ul>' : '') +
      '<p class="table-note">' + (n.origin === 'pocatecni-naplneni' ? 'Redakční text z počátečního naplnění pilotu. ' : 'Vlastní české shrnutí připravené automatikou podle redakčních pravidel webu. ') +
      'Shrnutí nenahrazuje původní článek. ' + (n.sourceDateUnknown ? 'Přesný čas publikace u zdroje nebyl zjištěn; uveden je čas zařazení na web.' : '') + '</p></div></article>';
  };

  views.zapasy = function () {
    var items = ((D.games && D.games.items) || []).slice().sort(function (a, b) { return b.gameDate.localeCompare(a.gameDate) || (a.type === 'review' ? -1 : 1); });
    var finals = games().filter(function (g) { return g.status === 'final'; }).reverse();
    return '<div class="page-head"><span class="eyebrow">Zápasy</span><h1>Preview, review a výsledky</h1>' + freshness('games', D.games, { noSource: true }) + '</div>' +
      '<section class="section"><div class="section__head"><h2>Preview a review</h2></div>' + (items.length ? '<div class="cards">' + items.map(gameCard).join('') + '</div>' : '<div class="notice notice--info">Zatím nic.</div>') + '</section>' +
      '<section class="section"><div class="section__head"><h2>Odehrané zápasy</h2><a class="more" href="#kalendar">Celý kalendář</a></div>' +
      (finals.length ? '<div class="cards">' + finals.map(function (g) { return scoreboard(g, true); }).join('') + '</div>' : '') + freshness('schedule', D.schedule) + '</section>';
  };

  views.game = function (id) {
    var it = ((D.games && D.games.items) || []).filter(function (x) { return x.id === id; })[0];
    if (!it) return notFound('Zápas nebyl nalezen.');
    var opp = teamName(it.opponent.abbr);
    var head = '<a class="back" href="#zapasy">Zpět na zápasy</a><div class="page-head"><span class="eyebrow">' + (it.type === 'preview' ? 'Preview' : 'Review') + ' · ' +
      esc(it.homeAway === 'home' ? 'Browns – ' + opp : opp + ' – Browns') + '</span><h1>' + esc(it.title) + '</h1>' +
      (it.perex ? '<p class="article__perex">' + esc(it.perex) + '</p>' : '') +
      (it.origin === 'pocatecni-naplneni' ? '<div class="notice"><strong>Redakční počáteční text</strong>Připraveno z veřejně dostupných zdrojů před spuštěním automatiky. Údaje nejsou ověřené sportovním datovým zdrojem.</div>' : '') +
      (it.textPending ? '<div class="notice"><strong>Český text se připravuje</strong>Zatím zobrazujeme jen data ze sportovního zdroje.</div>' : '') + '</div>';
    var info = '<dl class="kv"><div><dt>Termín (český čas)</dt><dd>' + esc(fmt(it.gameDate, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</dd></div>' +
      '<div><dt>Stadion</dt><dd style="font-size:1.1rem">' + esc(venueStr(it.venue)) + '</dd></div>' +
      (it.records ? '<div><dt>Bilance</dt><dd>' + esc(it.records.browns || '?') + ' <small>Browns</small> · ' + esc(it.records.opp || '?') + ' <small>' + esc(it.opponent.abbr) + '</small></dd></div>' : '') +
      (it.score ? '<div><dt>Výsledek</dt><dd>' + it.score.browns + ':' + it.score.opp + ' <small>' + esc({ W: 'výhra', L: 'prohra', T: 'remíza' }[it.result] || '') + (it.ot ? ' po prodl.' : '') + '</small></dd></div>' : '') +
      (it.broadcast ? '<div><dt>TV v USA</dt><dd>' + esc(it.broadcast) + '</dd></div>' : '') + '</dl>';
    var body = '';
    if (it.type === 'preview') {
      if (it.form) body += sec('Forma a tabulka', '<p>' + esc(it.form) + '</p>' + standingsTable(D.standings && D.standings.afcNorth));
      if ((it.keyMatchups || []).length) body += sec('Klíčové souboje', '<div class="matchups">' + it.keyMatchups.map(function (m) { return '<div class="callout"><h3>' + esc(m.title) + '</h3><p>' + esc(m.text) + '</p></div>'; }).join('') + '</div>');
      if ((it.keyPlayers || []).length) body += sec('Důležití hráči', '<div class="cards">' + it.keyPlayers.map(function (p) { return '<div class="card"><span class="card__kicker">' + esc(p.team) + '</span><span class="card__title">' + esc(p.name) + '</span><span class="card__text">' + esc(p.why) + '</span></div>'; }).join('') + '</div>');
      body += sec('Zranění, absence a návraty', (it.injuriesSummary ? '<p>' + esc(it.injuriesSummary) + '</p>' : '') + injuriesHtml(it.injuries));
      if ((it.watchFor || []).length) body += sec('Na co si dát pozor', '<ul>' + it.watchFor.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>');
      if (it.expectation) body += sec('Naše očekávání', '<div class="callout"><p>' + esc(it.expectation) + '</p></div>');
    } else {
      if ((it.flow || []).length) body += sec('Průběh zápasu', it.flow.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join(''));
      if ((it.quarters || []).length) body += sec('Skóre po čtvrtinách', quartersTable(it.quarters));
      if ((it.decisiveMoments || []).length) body += sec('Rozhodující momenty', '<ul>' + it.decisiveMoments.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>');
      if (it.whatDecided) body += sec('Co utkání rozhodlo', '<div class="callout"><p>' + esc(it.whatDecided) + '</p></div>');
      if ((it.topPlayers || []).length) body += sec('Nejlepší hráči Browns', '<div class="cards">' + it.topPlayers.map(function (p) { return '<div class="card"><span class="card__title">' + esc(p.name) + '</span><span class="card__kicker">' + esc(p.line) + '</span><span class="card__text">' + esc(p.why) + '</span></div>'; }).join('') + '</div>');
      if ((it.box || []).length) body += sec('Týmové statistiky', boxTable(it.box));
      if ((it.players || []).length) body += sec('Individuální statistiky Browns', '<div class="table-wrap"><table><thead><tr><th>Hráč</th><th>Kategorie</th><th>Výkon</th></tr></thead><tbody>' + it.players.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category) + '</td><td>' + esc(p.line) + '</td></tr>'; }).join('') + '</tbody></table></div>');
      if (it.seasonImpact) body += sec('Co výsledek znamená', '<p>' + esc(it.seasonImpact) + '</p>');
    }
    if (it.dataGaps) body += '<div class="notice notice--info"><strong>Co v podkladech chybí</strong>' + esc(it.dataGaps) + '</div>';
    body += '<div class="source-box"><strong>Zdroje a odkazy</strong><ul>' + (it.sources || []).map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></li>'; }).join('') + '</ul>' +
      '<p class="table-note">Připraveno ' + esc(fDateTime(it.createdAt)) + '.</p></div>';
    return head + info + '<div class="article" style="max-width:none">' + body + '</div>';
  };
  function sec(title, inner) { return '<section class="section"><div class="section__head"><h2>' + esc(title) + '</h2></div>' + inner + '</section>'; }
  function injuriesHtml(list) {
    if (!list || !list.length) return '<p class="table-note">Zprávy o zraněních nejsou k dispozici.</p>';
    return '<div class="injuries">' + list.map(function (t) {
      return '<div class="card"><span class="team-cell">' + badge(t.team, true) + '<strong>' + esc(teamName(t.team)) + '</strong></span><ul>' +
        (t.players.length ? t.players.map(function (p) { return '<li><span>' + esc(p.name) + ' <small class="table-note">' + esc(p.pos || '') + (p.detail ? ' · ' + esc(p.detail) : '') + '</small></span><span class="chip ' + (/out|ir|reserve/i.test(p.status || '') ? 'chip--bad' : 'chip--warn') + '">' + esc(p.statusCs || p.status) + '</span></li>'; }).join('') : '<li>Bez hlášených absencí</li>') + '</ul></div>';
    }).join('') + '</div>';
  }
  function quartersTable(q) {
    var n = Math.max.apply(null, q.map(function (t) { return t.quarters.length; }));
    var head = ''; for (var i = 0; i < n; i++) head += '<th class="r">' + (i < 4 ? (i + 1) + '.' : 'P') + '</th>';
    return '<div class="table-wrap"><table><thead><tr><th>Tým</th>' + head + '<th class="r">Celkem</th></tr></thead><tbody>' + q.map(function (t) {
      return '<tr' + (t.abbr === 'CLE' ? ' class="is-browns"' : '') + '><td>' + esc(teamName(t.abbr)) + '</td>' + t.quarters.map(function (v) { return '<td class="r">' + v + '</td>'; }).join('') + '<td class="r"><strong>' + t.score + '</strong></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function boxTable(box) {
    var keys = Object.keys(box[0].stats || {});
    return '<div class="table-wrap"><table><thead><tr><th>Statistika</th>' + box.map(function (t) { return '<th class="r">' + esc(t.abbr) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      keys.map(function (k) { return '<tr><td>' + esc(k) + '</td>' + box.map(function (t) { return '<td class="r">' + esc(t.stats[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }

  views.kalendar = function () {
    var gs = games();
    var nx = nextGame();
    return '<div class="page-head"><span class="eyebrow">Kalendář</span><h1>Rozpis a výsledky ' + esc(D.schedule ? D.schedule.season : '') + '</h1>' +
      '<p class="lead">Všechny časy jsou v českém čase. Volný týden: ' + esc((D.schedule && D.schedule.byeWeeks || []).join(', ') || '—') + '.</p>' + freshness('schedule', D.schedule) + '</div>' +
      dataNotice(D.schedule, 'schedule') +
      '<div class="table-wrap"><table><thead><tr><th class="r">Týden</th><th>Datum a čas</th><th>Soupeř</th><th>Místo</th><th class="r">Výsledek</th><th>TV v USA</th></tr></thead><tbody>' +
      gs.map(function (g) {
        var res = g.score ? '<span class="result-pill result-pill--' + g.result + '">' + g.result + '</span> ' + g.score.browns + ':' + g.score.opp + (g.ot ? ' P' : '') : (g.status === 'in' ? 'probíhá' : '—');
        return '<tr' + (nx && nx.id === g.id ? ' class="is-browns"' : '') + '><td class="r">' + esc(g.week || g.weekLabel) + '</td><td>' + esc(fmt(g.date, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })) +
          (g.timeTbd ? (g.status === 'final' ? '' : ' · čas nepotvrzen') : ' · ' + esc(fTime(g.date))) + '</td>' +
          '<td><span class="team-cell">' + badge(g.opponent.abbr, true) + (g.homeAway === 'home' ? 'vs ' : '@ ') + esc(teamName(g.opponent.abbr)) + '</span></td>' +
          '<td>' + esc(venueStr(g.venue)) + '</td><td class="r">' + res + '</td><td>' + esc(g.broadcast || '—') + (g.note ? ' <span class="table-note">· ' + esc(g.note) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  };

  views.tabulky = function () {
    var st = D.standings;
    var divs = st && st.divisions ? Object.keys(st.divisions).filter(function (d) { return d.indexOf('AFC') === 0 && d !== 'AFC North'; }).sort() : [];
    return '<div class="page-head"><span class="eyebrow">Tabulky</span><h1>AFC North a AFC</h1>' + freshness('standings', st) + '</div>' + dataNotice(st, 'standings') +
      sec('AFC North', standingsTable(st && st.afcNorth, { full: true })) +
      sec('Postavení v AFC (seed)', st && st.afc && st.afc.length ? standingsTable(st.afc, { full: true, seed: true }) + '<p class="table-note">Seedy 1–7 postupují do playoff. ' + esc(st.note || '') + '</p>' : '<div class="notice notice--info">Tabulka celé AFC zatím nebyla načtena z datového zdroje.</div>') +
      divs.map(function (d) { return sec(d, standingsTable(st.divisions[d], { full: true })); }).join('');
  };

  views.statistiky = function () {
    var st = D.stats;
    return '<div class="page-head"><span class="eyebrow">Statistiky</span><h1>Čísla sezóny</h1>' + freshness('stats', st) + '</div>' + dataNotice(st, 'stats') +
      sec('Bilance a tabulka', recordBlock() + standingsTable(D.standings && D.standings.afcNorth) + '<a class="more" href="#tabulky">Celé tabulky AFC</a>') +
      sec('Výsledky v sezóně', weeksStrip() + '<a class="more" href="#kalendar">Rozpis zbývajících zápasů</a>') +
      sec('Vedoucí hráči Browns', leadersBlock()) +
      sec('Týmové statistiky', st && st.team && st.team.length ? '<dl class="kv">' + st.team.map(function (s) { return '<div><dt>' + esc(s.label) + '</dt><dd class="num">' + esc(s.value) + (s.rank ? '<small>' + esc(s.rank) + ' v NFL</small>' : '') + '</dd></div>'; }).join('') + '</dl>' : '<div class="notice notice--info">Týmové statistiky zatím nejsou načtené.</div>') +
      sec('Soupiska', '<a class="btn btn--line" href="#soupiska">Otevřít soupisku a informace o hráčích</a>');
  };

  views.soupiska = function () {
    var r = D.roster;
    var groups = (r && r.groups) || [];
    return '<div class="page-head"><span class="eyebrow">Soupiska</span><h1>Hráči Browns</h1>' + freshness('roster', r) + '</div>' + dataNotice(r, 'roster') +
      (groups.length ? '<label class="visually-hidden" for="roster-q">Hledat hráče</label><input class="search" id="roster-q" type="search" placeholder="Hledat jméno, pozici nebo číslo…" autocomplete="off">' +
        groups.map(function (g) {
          return '<section class="section roster-group"><div class="section__head"><h2>' + esc(g.label) + '</h2><span class="table-note">' + g.players.length + ' hráčů</span></div>' +
            '<div class="table-wrap"><table><thead><tr><th class="r">#</th><th>Hráč</th><th>Pozice</th><th class="r">Věk</th><th>Výška / váha</th><th class="r">Roky v NFL</th><th>Univerzita</th><th>Stav</th></tr></thead><tbody>' +
            g.players.map(function (p) {
              return '<tr data-q="' + esc((p.name + ' ' + p.pos + ' ' + p.posCs + ' ' + (p.jersey || '')).toLowerCase()) + '"><td class="r">' + esc(p.jersey || '—') + '</td><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.pos || '') + ' <span class="table-note">' + esc(p.posCs || '') + '</span></td>' +
                '<td class="r">' + esc(p.age || '—') + '</td><td>' + esc([p.height, p.weight].filter(Boolean).join(' · ') || '—') + '</td><td class="r">' + esc(p.experience === 0 ? 'nováček' : p.experience == null ? '—' : p.experience) + '</td><td>' + esc(p.college || '—') + '</td>' +
                '<td>' + (p.injury ? '<span class="chip chip--warn">' + esc(p.injury.status) + (p.injury.detail ? ' · ' + esc(p.injury.detail) : '') + '</span>' : esc(p.status && p.status !== 'Active' ? p.status : '')) + '</td></tr>';
            }).join('') + '</tbody></table></div></section>';
        }).join('') : '<div class="empty"><h3>Soupiska zatím není načtená</h3><p>Po prvním běhu automatiky se zde objeví kompletní soupiska z datového zdroje včetně pozic, věku a zdravotního stavu.</p></div>');
  };

  views.videa = function (param) {
    var v = D.videos;
    var items = (v && v.items) || [];
    var cat = param || 'vse';
    var cats = ['vse'].concat(Object.keys(VIDEO_CATS).filter(function (c) { return items.some(function (x) { return x.category === c; }); }));
    var shown = cat === 'vse' ? items : items.filter(function (x) { return x.category === cat; });
    var links = '<div class="linklist"><a class="btn btn--line" href="https://www.youtube.com/@clevelandbrowns/videos" target="_blank" rel="noopener">YouTube Browns</a><a class="btn btn--line" href="https://www.youtube.com/@NFL/videos" target="_blank" rel="noopener">YouTube NFL</a><a class="btn btn--line" href="https://www.clevelandbrowns.com/video/" target="_blank" rel="noopener">Videa na ClevelandBrowns.com</a></div>';
    return '<div class="page-head"><span class="eyebrow">Videa</span><h1>Highlighty, tiskovky a zákulisí</h1>' +
      '<p class="lead">Vkládáme pouze videa z oficiálních kanálů. Přehrávají se přes YouTube a zůstávají hostovaná u původního zdroje.</p>' + freshness('videos', v, { noSource: true }) + '</div>' +
      (items.length ? '<div class="filters" role="toolbar" aria-label="Typ videa">' + cats.map(function (c) {
        return '<button class="btn btn--line" data-vfilter="' + c + '" aria-pressed="' + (c === cat) + '">' + esc(c === 'vse' ? 'Vše' : VIDEO_CATS[c]) + '</button>';
      }).join('') + '</div><div class="videos">' + shown.map(videoCard).join('') + '</div>' + links :
        '<div class="empty"><h3>Videa se načtou při prvním běhu automatiky</h3><p>Automatika sleduje oficiální YouTube kanály Browns a NFL (u NFL jen videa o Browns) a třídí je na highlighty, tiskové konference, zákulisí a analýzy.</p>' + links + '</div>');
  };
  function videoCard(x) {
    return '<article class="video"><div class="video__frame" data-yt="' + esc(x.id) + '">' +
      '<img src="' + esc(x.thumbnail) + '" alt="" loading="lazy">' +
      (EMBEDS
        ? '<button class="video__play" type="button" data-play="' + esc(x.id) + '" aria-label="Přehrát: ' + esc(x.titleCs || x.title) + '">'
        : '<a class="video__play" href="' + esc(x.url) + '" target="_blank" rel="noopener" aria-label="Přehrát na YouTube: ' + esc(x.titleCs || x.title) + '">') +
      '<span><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg></span>' + (EMBEDS ? '</button>' : '</a>') + '</div>' +
      '<span class="video__title">' + esc(x.titleCs || x.title) + '</span>' +
      '<span class="video__meta"><span>' + esc(VIDEO_CATS[x.category] || '') + '</span><span>' + esc(x.channel) + '</span><span>' + esc(fDateTime(x.publishedAt)) + '</span>' +
      '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">Otevřít na YouTube</a></span>' +
      (x.titleCs ? '<span class="table-note">Původní název: ' + esc(x.title) + '</span>' : '') + '</article>';
  }

  views.galerie = function () {
    var g = D.gallery;
    var items = (g && g.items) || [];
    var social = '<div class="linklist"><a class="btn btn--line" href="https://www.instagram.com/browns/" target="_blank" rel="noopener">Instagram @browns</a><a class="btn btn--line" href="https://x.com/Browns" target="_blank" rel="noopener">X @Browns</a><a class="btn btn--line" href="https://www.facebook.com/ClevelandBrowns" target="_blank" rel="noopener">Facebook Browns</a><a class="btn btn--line" href="https://www.clevelandbrowns.com/photos/" target="_blank" rel="noopener">Fotogalerie ClevelandBrowns.com</a></div>';
    return '<div class="page-head"><span class="eyebrow">Galerie</span><h1>Fotoarchiv</h1>' +
      '<p class="lead">Fotky zveřejňujeme jen s oprávněním nebo licencí a vždy s uvedením autora. Oficiální příspěvky vkládáme tak, aby zůstaly hostované u původního zdroje.</p></div>' +
      (items.length ? '<div class="cards">' + items.map(function (p) {
        return '<figure class="card">' + (p.type === 'photo' ? '<img src="' + esc(p.src) + '" alt="' + esc(p.alt || '') + '" loading="lazy">' : '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title || 'Oficiální příspěvek') + '</a>') +
          '<figcaption class="table-note">' + esc(p.caption || '') + ' · Foto: ' + esc(p.credit || 'neuvedeno') + (p.license ? ' · ' + esc(p.license) : '') + '</figcaption></figure>';
      }).join('') + '</div>' :
        '<div class="empty"><h3>Fotoarchiv se teprve buduje</h3><p>Během pilotu nepoužíváme fotografie bez výslovného oprávnění. Po pilotu oslovíme PR tým Cleveland Browns s žádostí o možnost využívat oficiální fotografie pro nekomerční český fanouškovský web. Do té doby najdete oficiální fotky přímo u zdroje:</p>' + social + '</div>');
  };

  views['o-webu'] = function () {
    var cfgSources = [
      ['ClevelandBrowns.com', 'oficiální web klubu', 'https://www.clevelandbrowns.com/'], ['NFL.com', 'oficiální web ligy', 'https://www.nfl.com/'],
      ['YouTube Browns a NFL', 'oficiální videa', 'https://www.youtube.com/@clevelandbrowns'], ['ESPN', 'sportovní data (výsledky, tabulky, statistiky, soupiska) a zprávy', 'https://www.espn.com/nfl/team/_/name/cle/cleveland-browns'],
      ['CBS Sports, cleveland.com a další ověřená média', 'zprávy, vždy s odkazem', 'https://www.cleveland.com/browns/']
    ];
    return '<div class="page-head"><span class="eyebrow">O webu</span><h1>Jak tento web vzniká</h1></div><div class="prose">' +
      '<div class="notice notice--info"><strong>Neoficiální český fanouškovský web. Není spojen ani podporován Cleveland Browns, NFL ani jejich partnery.</strong>Nekomerční projekt bez reklam, bannerů a sponzorovaných prvků. Aktuálně běží v soukromém pilotním provozu.</div>' +
      '<h2>Odkud bereme informace</h2><ul>' + cfgSources.map(function (s) { return '<li><a href="' + s[2] + '" target="_blank" rel="noopener">' + s[0] + '</a> – ' + s[1] + '</li>'; }).join('') + '</ul>' +
      '<h2>Jak vznikají aktuality</h2><p>Dvakrát denně (v 8:00 a ve 20:00) automatika projde předem vybrané důvěryhodné zdroje, vyřadí nerelevantní a duplicitní zprávy a z každé nové vytvoří krátké vlastní české shrnutí: co se stalo a proč je to důležité pro Browns. U každé zprávy je odkaz na původní článek, datum a čas.</p>' +
      '<p>Texty jsou redakční souhrny, ne překlady celých článků. Citlivé zprávy (zranění, trejdy, propuštění, změny trenérů) bez potvrzení od Browns nebo NFL označujeme štítkem „Nepotvrzeno oficiálně“. Když oficiální zdroj zprávu potvrdí, štítek se změní.</p>' +
      '<h2>Sportovní data</h2><p>Výsledky, kalendář, tabulky, statistiky a soupiska se načítají ze sportovního datového zdroje a před zveřejněním se kontrolují (například zda bilance odpovídá výsledkům). V zápasový den se výsledek kontroluje každých 15 minut. Když se aktualizace nepovede, web ponechá poslední ověřená data a viditelně upozorní, z jaké doby jsou.</p>' +
      '<h2>Fotografie a videa</h2><p>Videa vkládáme jen z oficiálních kanálů přes jejich přehrávač. Fotografie používáme pouze s oprávněním nebo licencí a s uvedením autora. Loga týmů nepoužíváme; týmy označujeme zkratkou v jejich barvě.</p>' +
      '<h2>Časy</h2><p>Všechny časy jsou v českém čase (Europe/Prague), včetně přechodu na letní a zimní čas.</p>' +
      '<p><a href="#stav">Podrobný stav automatiky a zdrojů →</a></p></div>';
  };

  views.stav = function () {
    var s = D.status || { tasks: {} };
    var run = s.run;
    var rows = Object.keys(TASK_LABELS).map(function (k) {
      var t = s.tasks[k] || {};
      var chip = t.origin === 'pocatecni-naplneni' ? '<span class="chip chip--warn">Čeká na první běh</span>' : t.ok ? '<span class="chip chip--ok">V pořádku</span>' : '<span class="chip chip--bad">Chyba</span>';
      var srcs = t.details && t.details.sources;
      return '<div class="status-row"><div class="status-row__top"><span>' + esc(TASK_LABELS[k]) + '</span>' + chip + '</div>' +
        '<p>Poslední úspěšná aktualizace: <strong>' + esc(t.lastSuccessAt ? fDateTime(t.lastSuccessAt) + ' (' + rel(t.lastSuccessAt) + ')' : 'zatím žádná') + '</strong> · poslední pokus: ' + esc(t.lastAttemptAt ? fDateTime(t.lastAttemptAt) : '—') + '</p>' +
        (t.message ? '<p>' + esc(t.message) + '</p>' : '') +
        (srcs ? '<details><summary>Zdroje (' + srcs.filter(function (x) { return x.ok; }).length + '/' + srcs.length + ' funkčních)</summary><ul>' + srcs.map(function (x) { return '<li>' + esc(x.name) + ': ' + (x.ok ? 'OK, ' + x.items + ' položek, relevantních ' + x.relevant : 'nedostupné – ' + esc(x.error)) + '</li>'; }).join('') + '</ul></details>' : '') + '</div>';
    }).join('');
    return '<div class="page-head"><span class="eyebrow">Pilotní provoz</span><h1>Stav automatiky</h1>' +
      '<p class="lead">Transparentní přehled, kdy se která data naposledy úspěšně aktualizovala. Plánované běhy: denně v 8:00 a 20:00 českého času, v zápasový den navíc každých 15 minut.</p>' +
      '<p class="table-note">Poslední běh: ' + (run && run.lastRunAt ? esc(fDateTime(run.lastRunAt)) + ' (' + esc(run.lastMode) + ')' : 'automatika zatím neběžela') + '</p></div>' +
      (D._failed ? '<div class="notice notice--bad"><strong>Některé soubory se nepodařilo načíst</strong>' + esc(D._failed.join(', ')) + '</div>' : '') +
      '<div class="status-list">' + rows + '</div>';
  };

  function notFound(msg) { return '<div class="empty"><h3>' + esc(msg) + '</h3><a class="more" href="#">Zpět na přehled</a></div>'; }

  // --------------------------------------------------------------------- router
  var ROUTES = { '': 'home', aktuality: 'aktuality', zapasy: 'zapasy', statistiky: 'statistiky', tabulky: 'tabulky', kalendar: 'kalendar', soupiska: 'soupiska', videa: 'videa', galerie: 'galerie', 'o-webu': 'o-webu', stav: 'stav' };
  var NAV_OF = { home: 'home', aktuality: 'aktuality', article: 'aktuality', zapasy: 'zapasy', game: 'zapasy', kalendar: 'zapasy', statistiky: 'statistiky', tabulky: 'statistiky', soupiska: 'soupiska', videa: 'videa', galerie: 'galerie' };
  var TITLES = { home: '', aktuality: 'Aktuality', zapasy: 'Zápasy', statistiky: 'Statistiky', tabulky: 'Tabulky', kalendar: 'Kalendář', soupiska: 'Soupiska', videa: 'Videa', galerie: 'Galerie', 'o-webu': 'O webu', stav: 'Stav automatiky', article: 'Aktualita', game: 'Zápas' };
  var filterState = { news: null, video: null };

  function render(keepScroll) {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    var view, param;
    if (h.indexOf('a-') === 0) { view = 'article'; param = h.slice(2); }
    else if (h.indexOf('z-') === 0) { view = 'game'; param = h.slice(2); }
    else { view = ROUTES[h] || 'home'; }
    if (view === 'aktuality') param = filterState.news;
    if (view === 'videa') param = filterState.video;
    var main = document.getElementById('obsah');
    var html;
    try { html = views[view](param); } catch (e) { console.error(e); html = notFound('Stránku se nepodařilo zobrazit.'); }
    main.innerHTML = html;
    document.title = (TITLES[view] ? TITLES[view] + ' · ' : '') + 'Cleveland Browns Česky';
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === NAV_OF[view]) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!keepScroll) window.scrollTo(0, 0);
    tickCountdowns();
  }

  document.addEventListener('click', function (e) {
    var f = e.target.closest('[data-filter]');
    if (f) { filterState.news = f.getAttribute('data-filter'); render(true); return; }
    var vf = e.target.closest('[data-vfilter]');
    if (vf) { filterState.video = vf.getAttribute('data-vfilter'); render(true); return; }
    var p = e.target.closest('[data-play]');
    if (p) {
      var id = p.getAttribute('data-play');
      var frame = p.parentElement;
      frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'roster-q') return;
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('tr[data-q]').forEach(function (tr) { tr.hidden = q && tr.getAttribute('data-q').indexOf(q) === -1; });
  });
  window.addEventListener('hashchange', function () { render(false); });

  load().then(function () {
    render(true);
    timers.push(setInterval(tickCountdowns, 1000));
    // Automatické obnovení dat každých 5 minut (bez přeskakování stránky).
    timers.push(setInterval(function () { load().then(function () { if (!document.activeElement || document.activeElement.id !== 'roster-q') render(true); }); }, 5 * 60 * 1000));
  });
})();
