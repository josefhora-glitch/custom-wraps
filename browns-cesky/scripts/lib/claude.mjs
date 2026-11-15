// Generování českých redakčních textů přes Claude API (oficiální SDK, strukturovaný JSON výstup).
// Bez ANTHROPIC_API_KEY se nic negeneruje – položky čekají ve frontě a web nic nevymýšlí.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.BROWNS_CLAUDE_MODEL || 'claude-opus-5-5';
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client = null;
const getClient = () => (client ||= new Anthropic());

export const EDITORIAL_RULES = `Jsi redaktor neoficiálního českého fanouškovského magazínu „Cleveland Browns Česky“.
Pravidla (závazná):
- Píšeš přirozenou, živou, ale věcnou češtinou pro české fanoušky NFL. Žádný doslovný překlad, žádné kopírování vět ze zdroje.
- Vycházíš VÝHRADNĚ z dodaného podkladu. Nic si nedomýšlej: jména, čísla, data, výsledky a citace jen pokud jsou v podkladu.
- Pokud podklad něco neuvádí nebo je to nejisté, napiš to otevřeně („zatím nepotvrzeno“, „podle zdroje X“).
- U citlivých zpráv (zranění, trejdy, propuštění, změny trenérů, disciplinární tresty) jasně uveď, kdo informaci přináší, a pokud nejde o oficiální zdroj Browns/NFL, označ ji jako nepotvrzenou oficiálně.
- Zachovávej zavedené anglické termíny NFL (quarterback, touchdown, sack, interception, injury report, practice squad…), u méně známých přidej stručné vysvětlení.
- Časy uváděj v českém čase, pokud je máš k dispozici v podkladu jako český čas.
- Žádná reklama, sázkové kurzy ani sázkové tipy.
- Délka: stručně a hodnotně – raději méně odstavců s fakty než vata.`;

/**
 * Zavolá Claude a vrátí objekt odpovídající JSON schématu.
 * Používá server-side fallback pro případ odmítnutí a validuje výsledek.
 */
export async function generateJson({ system = EDITORIAL_RULES, prompt, schema, effort = 'medium', maxTokens = 16000 }) {
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  });
  if (res.stop_reason === 'refusal') throw new Error(`Model odmítl požadavek (${res.stop_details?.category || 'bez kategorie'}).`);
  if (res.stop_reason === 'max_tokens') throw new Error('Odpověď byla useknuta (max_tokens).');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Model nevrátil platný JSON.');
  }
  const missing = (schema.required || []).filter((k) => !(k in parsed));
  if (missing.length) throw new Error(`Odpovědi chybí pole: ${missing.join(', ')}`);
  return { data: parsed, model: res.model, usage: res.usage };
}

// --------------------------------------------------------------------------- schémata
const str = { type: 'string' };
const strArr = { type: 'array', items: str };

export const NEWS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relevant', 'relevanceReason', 'duplicateOf', 'category', 'sensitive', 'titleCs', 'perex', 'whatHappened', 'whyItMatters', 'unverified', 'tags'],
  properties: {
    relevant: { type: 'boolean', description: 'Týká se zpráva přímo Cleveland Browns (hráči, tým, soupeř v nejbližším zápase, AFC North s dopadem na Browns)?' },
    relevanceReason: str,
    duplicateOf: { type: ['string', 'null'], description: 'ID existující aktuality, pokud jde o stejnou událost; jinak null.' },
    category: { type: 'string', enum: ['zapasy', 'zraneni', 'soupiska', 'trejdy', 'treneri', 'draft', 'smlouvy', 'tabulka', 'klub', 'ostatni'] },
    sensitive: { type: 'boolean', description: 'Zranění, trejd, propuštění, změna trenéra, trest apod.' },
    titleCs: { type: 'string', description: 'Vlastní český titulek, max ~90 znaků, bez clickbaitu.' },
    perex: { type: 'string', description: '1–2 věty: to nejdůležitější.' },
    whatHappened: { type: 'array', items: str, description: '1–3 krátké odstavce: co se stalo.' },
    whyItMatters: { type: 'string', description: '1 odstavec: proč je to důležité pro Browns.' },
    unverified: { type: 'string', description: 'Co není potvrzeno / na co čekáme. Prázdný řetězec, pokud nic.' },
    tags: strArr,
  },
};

export const PREVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'perex', 'form', 'keyMatchups', 'keyPlayers', 'injuriesSummary', 'watchFor', 'expectation', 'dataGaps'],
  properties: {
    title: str,
    perex: str,
    form: { type: 'string', description: 'Aktuální forma obou týmů a postavení v tabulce – jen z podkladu.' },
    keyMatchups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: str, text: str } } },
    keyPlayers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['team', 'name', 'why'], properties: { team: str, name: str, why: str } } },
    injuriesSummary: str,
    watchFor: strArr,
    expectation: { type: 'string', description: 'Krátké české očekávání/tip na průběh (ne sázkový tip).' },
    dataGaps: { type: 'string', description: 'Co v podkladu chybělo nebo není ověřeno.' },
  },
};

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'perex', 'flow', 'decisiveMoments', 'topPlayers', 'whatDecided', 'seasonImpact', 'dataGaps'],
  properties: {
    title: str,
    perex: str,
    flow: { type: 'array', items: str, description: '2–3 odstavce o průběhu.' },
    decisiveMoments: strArr,
    topPlayers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'line', 'why'], properties: { name: str, line: str, why: str } } },
    whatDecided: str,
    seasonImpact: { type: 'string', description: 'Co výsledek znamená pro sezónu, AFC North a playoff – jen z podkladu.' },
    dataGaps: str,
  },
};
