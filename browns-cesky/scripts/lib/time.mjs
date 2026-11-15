// Práce s časem: vše se ukládá v UTC (ISO), zobrazuje se v Europe/Prague.
export const TZ = 'Europe/Prague';

/** Vrátí {hour, minute, weekday, date} v pražském čase. */
export function pragueParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function formatPrague(iso, opts = {}) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: TZ,
    dateStyle: 'full',
    timeStyle: 'short',
    ...opts,
  }).format(new Date(iso));
}

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
