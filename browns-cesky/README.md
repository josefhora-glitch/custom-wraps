# Cleveland Browns Česky (pilot)

Neoficiální, nekomerční český fanouškovský magazín a informační hub o Cleveland Browns.
**Není spojen ani podporován Cleveland Browns, NFL ani jejich partnery.** Bez reklam, bannerů a sponzorovaných prvků.

## Co je hotové

| Část | Kde | Popis |
|---|---|---|
| Web | `site/` | Statická mobilní-first aplikace (HTML + CSS + JS, bez frameworku). Čte data z `site/data/*.json`. |
| Sportovní data | `scripts/update-sports.mjs` | Výsledky, kalendář, tabulka AFC North a AFC, týmové statistiky, lídři, soupiska (veřejná data ESPN). Validace: bilance musí sedět s výsledky, ukončený zápas musí mít skóre. |
| Aktuality | `scripts/update-news.mjs` | Projde zdroje z `config/sources.json`, vyfiltruje relevantní zprávy, odstraní duplicity a přes Claude API vytvoří krátké české redakční shrnutí. Citlivé zprávy bez oficiálního zdroje dostanou štítek „Nepotvrzeno oficiálně“. |
| Preview / review | `scripts/update-games.mjs` | Preview do 6 dnů před zápasem, review po skončení. Fakta (skóre, čtvrtiny, statistiky, zranění) jdou z datového zdroje, Claude z nich jen píše text. |
| Videa | `scripts/update-videos.mjs` | Oficiální YouTube kanály Browns a NFL (u NFL jen videa o Browns), roztříděná na highlighty, tiskovky, zákulisí a analýzy. |
| Orchestrace | `scripts/run.mjs` | Režimy `scheduled` (8:00 a 20:00 Praha), `gameday` (každých 15 min v herním okně), `force`. |
| Kontrola | `scripts/validate.mjs`, `npm test` | Validace dat před publikací a jednotkové testy (deduplikace, normalizace zápasů, herní okno, pražský čas). |
| CI | `../.github/workflows/browns-cesky.yml` | Plánovaný běh, validace, commit dat, nasazení na Cloudflare Pages. |

Stránky webu: Přehled, Aktuality (+ detail), Zápasy (preview/review), Kalendář, Tabulky, Statistiky, Soupiska, Videa, Galerie, O webu, Stav automatiky.

## Zásady spolehlivosti

* Každý datový blok ukazuje čas poslední aktualizace a zdroj.
* Když aktualizace selže, data se **nepřepíšou**: web ukáže poslední ověřený stav a viditelné upozornění s důvodem.
* Data z počátečního ručního naplnění jsou označena „Počáteční data · neověřeno datovým zdrojem“, dokud je nenahradí první běh automatiky.
* Bez `ANTHROPIC_API_KEY` se české texty negenerují: zprávy čekají ve frontě (`state/queue.json`) a web nic nevymýšlí.

## Spuštění lokálně

```bash
cd browns-cesky
npm ci
npm test                       # testy
npm run update:force           # všechny aktualizace hned (potřebuje síť; pro texty ANTHROPIC_API_KEY)
node scripts/validate.mjs      # kontrola dat
npm run serve                  # web na http://localhost:8080
```

Proměnné prostředí: `ANTHROPIC_API_KEY` (česká shrnutí), `BROWNS_CLAUDE_MODEL` (výchozí `claude-opus-5-5`),
`BROWNS_SEASON` (vynutit sezónu), `BROWNS_MAX_NEWS` (max. nových zpráv na běh, výchozí 8).

Nastavení pilotu krok za krokem: [`docs/PILOT.md`](docs/PILOT.md). Práva k fotkám a videím: [`docs/PRAVA-A-MEDIA.md`](docs/PRAVA-A-MEDIA.md).
Návrh e-mailu pro PR tým Browns: [`docs/EMAIL-PR-BROWNS.md`](docs/EMAIL-PR-BROWNS.md).
