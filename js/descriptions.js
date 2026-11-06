/**
 * descriptions.js – Beschreibungen hinter dem „i“: Kurzfassungen in eigenen Worten (Grundregelwerk,
 * siehe data/beschreibungen.js) und Links zum offiziellen DSA5-Regel-Wiki von Ulisses.
 *
 * Offizielle Texte dürfen nicht in die App kopiert werden (Ulisses: nur private Kopien, Fanrichtlinien:
 * keine Textübernahme über Zitate hinaus). Deshalb: kurze Zusammenfassung + Link + eigener Text, den
 * jede Gruppe selbst pflegt. Einträge ohne Kurzfassung bekommen einen Suchlink auf ihren Namen –
 * das klappt auch für alles, was erst später erscheint.
 */
import { DESCRIPTIONS } from './data/beschreibungen.js';

export const REGELWIKI_URL = 'https://dsa.ulisses-regelwiki.de/';

/** Arten von Einträgen im Katalog (Liste im Heldenbogen → Katalog-Arten). */
export const DESCRIPTION_KINDS = Object.freeze({
  spells: 'zauber,ritual,liturgie,zeremonie',
  cantrips: 'zaubertrick,segen',
  advantages: 'vorteil',
  disadvantages: 'nachteil',
  specialAbilities: 'sf',
  languages: 'sf',
  tradeSecrets: 'sf',
  inventory: 'ausruestung',
  weapons: 'waffe',
  armor: 'ruestung',
});

/** Vergleichsschlüssel: klein, ohne Umlaut-Unterschiede und Satzzeichen („Körperbeherrschung“ = „koerperbeherrschung“). */
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LEVEL = /\s+(?:[IVX]+(?:\s*[-–/]\s*[IVX]+)?|\d+(?:\s*[-–/]\s*\d+)?)\s*$/;

/** Name ohne Stufe am Ende („Glück II“ → „Glück“) und ohne Klammern („Begabung (Klettern)“ → „Begabung“). */
export function baseName(name) {
  return String(name ?? '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEVEL, '')
    .trim();
}

function variants(name) {
  const full = String(name ?? '').trim();
  const withoutParens = full
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...new Set([full, withoutParens, full.replace(LEVEL, ''), baseName(full)].map(nameKey))].filter(Boolean);
}

/** Katalog: Art → Schlüssel → Eintrag { kind, name, url, summary }. */
const INDEX = new Map();
for (const [kind, name, url, summary] of DESCRIPTIONS) {
  const entry = Object.freeze({ kind, name, url, summary });
  if (!INDEX.has(kind)) INDEX.set(kind, new Map());
  const byKey = INDEX.get(kind);
  for (const key of variants(name)) if (!byKey.has(key)) byKey.set(key, entry);
}

function kindsOf(kinds) {
  const list = String(kinds ?? '')
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean);
  // „sf“ steht für alle Sonderfertigkeiten (profan, magisch, karmal)
  return list.flatMap((kind) => (kind === 'sf' ? ['sf', 'sf-profan', 'sf-magisch', 'sf-karmal'] : [kind]));
}

/** Katalogeintrag zu einem Namen (z. B. „Belastungsgewöhnung II“ → „Belastungsgewöhnung I-II“) oder null. */
export function findDescription(kinds, name) {
  const keys = variants(name);
  for (const kind of kindsOf(kinds)) {
    const byKey = INDEX.get(kind);
    if (!byKey) continue;
    for (const key of keys) if (byKey.has(key)) return byKey.get(key);
  }
  return null;
}

/** Suche im offiziellen Regel-Wiki nach einem Namen (ohne Stufe und Klammern). */
export function searchUrl(name) {
  const term = baseName(name) || String(name ?? '').trim();
  return `${REGELWIKI_URL}suche.html?keywords=${encodeURIComponent(term)}`;
}

/**
 * Alles fürs „i“: Kurzfassung (oder null), Link zum offiziellen Eintrag (sonst Suche) und dessen Text.
 * @returns {{ summary: string|null, url: string|null, linkText: string, entry: object|null }}
 */
export function describeEntry(kinds, name) {
  const text = String(name ?? '').trim();
  if (!text) return { summary: null, url: null, linkText: '', entry: null };
  const entry = findDescription(kinds, text);
  if (entry?.url) {
    return {
      summary: entry.summary || null,
      url: new URL(entry.url, REGELWIKI_URL).href,
      linkText: `Offizieller Text im Regel-Wiki: „${entry.name}“ ↗`,
      entry,
    };
  }
  return {
    summary: entry?.summary || null,
    url: searchUrl(text),
    linkText: `Im Regel-Wiki nach „${baseName(text) || text}“ suchen ↗`,
    entry,
  };
}

/** Wie viele Kurzfassungen der Katalog kennt (für Tests und die Anzeige). */
export function catalogSize() {
  return DESCRIPTIONS.filter((entry) => entry[3]).length;
}
