// Orchestrace automatiky.
//  --mode=scheduled  pravidelný běh 2× denně (8:00 a 20:00 českého času; GitHub cron spouští v UTC,
//                    proto se plánuje víc slotů a skript sám pozná správnou pražskou hodinu – funguje i při změně času)
//  --mode=gameday    častá kontrola v zápasový den (jen v herním okně Browns, jinak okamžitě skončí)
//  --mode=force      vše hned
import { readJson, writeJson, log } from './lib/io.mjs';
import { pragueParts, HOUR } from './lib/time.mjs';
import { updateSports } from './update-sports.mjs';
import { updateNews } from './update-news.mjs';
import { updateVideos } from './update-videos.mjs';
import { updateGames } from './update-games.mjs';

const RUN_HOURS = (process.env.BROWNS_RUN_HOURS || '8,20').split(',').map(Number);

export function inGameWindow(schedule, now = Date.now()) {
  if (!schedule?.games) return null;
  return (
    schedule.games.find((g) => {
      const k = Date.parse(g.date);
      const before = k - 2 * HOUR;
      const after = k + 5.5 * HOUR;
      // v okně, nebo zápas před < 12 h, který ještě není v datech ukončen
      return (now >= before && now <= after) || (g.status !== 'final' && now > k && now - k < 12 * HOUR);
    }) || null
  );
}

async function main() {
  const mode = process.argv.find((a) => a.startsWith('--mode='))?.slice(7) || 'scheduled';
  const prague = pragueParts();
  const status = (await readJson('status.json', null)) || { tasks: {} };
  const ran = [];

  if (mode === 'scheduled') {
    const slot = `${prague.date}T${String(prague.hour).padStart(2, '0')}`;
    if (!RUN_HOURS.includes(prague.hour) && !process.env.BROWNS_IGNORE_HOUR) {
      log('run', `Pražský čas ${prague.hour}:${String(prague.minute).padStart(2, '0')} – mimo plánované hodiny ${RUN_HOURS.join(', ')}, končím.`);
      return;
    }
    if (status.run?.lastScheduledSlot === slot && !process.env.BROWNS_IGNORE_HOUR) {
      log('run', `Slot ${slot} už proběhl, končím.`);
      return;
    }
    await updateSports();
    ran.push('sports');
    await updateNews();
    ran.push('news');
    await updateVideos();
    ran.push('videos');
    await updateGames();
    ran.push('games');
    const s = (await readJson('status.json')) || status;
    s.run = { ...(s.run || {}), lastScheduledSlot: slot };
    await writeJson('status.json', s);
  } else if (mode === 'gameday') {
    const schedule = await readJson('schedule.json');
    const game = inGameWindow(schedule);
    if (!game) {
      log('run', 'Žádný zápas Browns v herním okně, končím.');
      return;
    }
    log('run', `Herní okno: ${game.opponent.abbr} (${game.date})`);
    await updateSports({ only: ['schedule', 'standings'] });
    ran.push('schedule', 'standings');
    const fresh = await readJson('schedule.json');
    const g = fresh.games.find((x) => x.id === game.id);
    if (g?.status === 'final') {
      await updateSports({ only: ['stats'] });
      await updateGames();
      ran.push('stats', 'games');
    }
  } else {
    await updateSports();
    await updateNews();
    await updateVideos();
    await updateGames({ force: process.argv.includes('--regenerate') });
    ran.push('all');
  }

  const s = (await readJson('status.json')) || { tasks: {} };
  s.run = { ...(s.run || {}), lastRunAt: new Date().toISOString(), lastMode: mode, ran };
  await writeJson('status.json', s);
  log('run', `Hotovo (${mode}): ${ran.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exitCode = 1; });
