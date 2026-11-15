# Pilot: nastavení a kontrolní seznam

Pilot běží 2–3 týdny v soukromém náhledu. Tento dokument popisuje, jak ho zprovoznit a co během něj sledovat.

## 1. Zprovoznění (jednorázově, cca 30 minut)

### a) Automatika v GitHub Actions
GitHub spouští plánované workflow **jen z výchozí větve** repozitáře. Doporučený postup:

1. Pro projekt založit **samostatný soukromý repozitář** (např. `browns-cesky`) a obsah složky `browns-cesky/` + `.github/workflows/browns-cesky.yml` do něj přesunout. (Aktuálně je pilot ve větvi repozitáře `custom-wraps`, který slouží jinému účelu.)
   Alternativa: sloučit větev pilotu do výchozí větve tohoto repozitáře.
2. V nastavení repozitáře → *Secrets and variables → Actions* přidat:
   * Secret `ANTHROPIC_API_KEY` – pro česká shrnutí, preview a review. Bez něj poběží jen sportovní data a videa.
   * Volitelně variable `BROWNS_BRANCH` – větev, do které se commitují data (výchozí: větev, ze které workflow běží).
   * Volitelně variable `BROWNS_CLAUDE_MODEL` (výchozí `claude-opus-5-5`).
3. Spustit ručně *Actions → Browns Česky – aktualizace → Run workflow → force*. Tím se poprvé načtou ověřená data a nahradí počáteční naplnění.

### b) Soukromý náhled webu (doporučeno: Cloudflare Pages + Cloudflare Access)
1. Na Cloudflare (zdarma) vytvořit projekt Pages `browns-cesky` (Direct Upload).
2. V *Zero Trust → Access → Applications* přidat aplikaci pro doménu `browns-cesky.pages.dev` a povolit přístup jen vybraným e-mailům (jednorázový kód do e-mailu). Tím je web skutečně neveřejný.
3. Do GitHubu přidat secrets `CLOUDFLARE_API_TOKEN` (oprávnění *Cloudflare Pages: Edit*) a `CLOUDFLARE_ACCOUNT_ID`.
4. Workflow pak po každé změně dat web sám nasadí.

Web má navíc `noindex` (meta tag, `robots.txt`, hlavička `X-Robots-Tag`), aby se nedostal do vyhledávačů.
GitHub Pages pro soukromý náhled nedoporučujeme: na veřejném repozitáři je web veřejný.

## 2. Plán automatiky

| Kdy | Co |
|---|---|
| 8:00 a 20:00 (Praha) | Sportovní data, aktuality, videa, preview/review |
| Zápasový den, každých 15 min v okně −2 h až +5,5 h od výkopu | Výsledek, tabulka; po skončení statistiky a review |
| Při selhání | Data zůstanou, web ukáže čas poslední úspěšné aktualizace a důvod chyby (stránka *Stav automatiky*) |

## 3. Co během pilotu sledovat

Doporučení: 1× denně projít web na telefonu a zapsat poznámky do tabulky (datum, sekce, problém).

**Spolehlivost načítání**
- [ ] Stránka *Stav automatiky*: všechny úlohy zelené, běhy v 8:00 a 20:00 proběhly.
- [ ] Které RSS zdroje fungují (rozbalit „Zdroje“ u Aktualit). Nefunkční URL upravit v `config/sources.json`.
- [ ] V zápasový den: výsledek se objeví do ~30 min po konci zápasu, review do další hodiny.

**Kvalita češtiny a shrnutí**
- [ ] Texty nejsou doslovné překlady, mají 1–3 krátké odstavce, „proč je to důležité“ dává smysl.
- [ ] Žádná vymyšlená čísla ani jména (namátkově porovnat s původním zdrojem).
- [ ] Citlivé zprávy mají štítek „Nepotvrzeno oficiálně“, dokud je nepotvrdí Browns/NFL.

**Duplicity**
- [ ] Stejná událost z více médií = jedna aktualita s více zdroji („Další zdroje ke zprávě“).

**Správnost dat**
- [ ] Bilance, skóre a tabulka sedí s NFL.com (namátkou po každém zápase).
- [ ] Časy výkopů v českém čase (pozor na přechody času v USA a v Evropě).
- [ ] Žádné upozornění „Kontrola dat“ (rozpor bilance vs. výsledky).

**Přehlednost**
- [ ] Mobil: domovská stránka ukáže příští zápas, poslední výsledek a bilanci bez scrollování přes celou stránku.
- [ ] Počítač: dvousloupcové rozvržení, tabulky čitelné.

**Média a zdroje**
- [ ] Videa se přehrávají (vložený YouTube přehrávač), u každého je kanál a datum.
- [ ] Žádný obrázek bez uvedeného autora/licence.

## 4. Po pilotu – rozhodnutí
- Vlastní doména (např. `browns-cesky.cz`) – připojit v Cloudflare Pages.
- Veřejné spuštění: vypnout Cloudflare Access a `noindex`, zkontrolovat zásady ochrany soukromí (Google Fonts → doporučujeme písma hostovat lokálně).
- Odeslat e-mail PR týmu Browns (`docs/EMAIL-PR-BROWNS.md`).
- Vyhodnotit náklady na Claude API (při ~10 zprávách denně jde o jednotky dolarů měsíčně; přesně podle reálného provozu).

## 5. Známá omezení pilotu
- Sportovní data jsou z veřejných, ale neoficiálních JSON endpointů ESPN. Parsery jsou psané defenzivně a výstup se validuje; pokud ESPN formát změní, aktualizace selže viditelně a data se nepřepíšou. Před veřejným spuštěním zvážit placené datové API s licencí (např. Sportradar).
- Přesné RSS adresy oficiálních webů se mohou měnit – skript zkouší více variant a do stavu zapíše, která funguje.
- Počáteční obsah (rozpis, AFC North, 3 aktuality, preview 10. týdne) byl naplněn ručně z veřejných zdrojů, protože prostředí, ve kterém pilot vznikl, nemělo přístup k datovým zdrojům. Je na webu zřetelně označen a první běh automatiky ho nahradí.
