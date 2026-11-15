# Fotografie, videa a práva

Web je nekomerční, ale to samo o sobě neopravňuje k použití cizích fotografií. Platí tato pravidla:

## Co web dělá automaticky
* **Videa** jen z oficiálních YouTube kanálů (Browns, NFL), přehrávaná přes oficiální vložený přehrávač (`youtube-nocookie.com`). Video zůstává hostované u zdroje, u každého je kanál a datum.
* **Náhledy videí** z YouTube (`i.ytimg.com`) jsou součástí vkládání videa.
* **Aktuality nepřebírají obrázky** z článků (pole `image` je prázdné). Automatika žádné fotky nestahuje.
* **Loga týmů se nepoužívají** – týmy jsou označené zkratkou v barvě týmu. Vlastní „logo“ webu je jen typografie a pruh, ne logo Browns.

## Co se nesmí
* Používat fotky z Facebooku, Instagramu, webů klubu či médií jen proto, že jsou veřejně dostupné.
* Používat fotky agentur (AP, Getty, USA TODAY Sports, Imagn…) z novinářských webů bez licence.
* Ořezávat nebo odstraňovat vodoznaky a popisky autorů.

## Jak přidat fotku do galerie (ručně)
Do `site/data/gallery.json` přidat položku jen tehdy, když máte oprávnění:

```json
{
  "type": "photo",
  "src": "media/2026-11-15-stadion.jpg",
  "alt": "Huntington Bank Field před zápasem",
  "caption": "Stadion před zápasem s Houstonem",
  "credit": "Jméno autora",
  "license": "Vlastní fotografie / CC BY 4.0 / písemné svolení (datum)"
}
```

Soubor uložit do `site/media/`. Validátor (`scripts/validate.mjs`) odmítne položku bez autora a licence.

Vložený oficiální příspěvek (zůstává u zdroje):

```json
{ "type": "embed", "url": "https://www.instagram.com/p/XXXX/", "title": "Příspěvek Browns", "credit": "Cleveland Browns (oficiální účet)" }
```

## Vhodné zdroje s licencí
* Vlastní fotografie (např. z návštěvy zápasu).
* Wikimedia Commons – jen s licencí, která dovoluje použití, a vždy s autorem a licencí.
* Oficiální materiály Browns – až po písemném svolení (viz `EMAIL-PR-BROWNS.md`).
