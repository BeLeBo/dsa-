/**
 * optolith.js – Helden aus Optolith (Heldengenerator für DSA5) übernehmen. Kein DOM.
 *
 * Optolith bietet zwei passende Exporte:
 *  - MapTool-Token (.rptok): alle Werte mit Namen und die fertig berechneten Grundwerte
 *    (LeP, SK, ZK, AP ausgegeben …). Darin steht eine Liste „Schlüssel = Wert“ (content.xml);
 *    viele Werte sind JSON-Texte, z. B. Vorteile = [{"Name":"Reich","Stufe":3}].
 *  - Heldendatei (.json): Werte, Inventar und persönliche Daten. Vorteile, Sonderfertigkeiten,
 *    Zauber usw. stehen dort nur als Nummern (z. B. „ADV_36“) – die Namen dazu liegen in
 *    Optolith selbst und werden nicht mit exportiert.
 * Am besten beide zusammen: Namen und Grundwerte aus dem Token, persönliche Daten, Spezies,
 * Erfahrungsgrad und Gegenstandsarten aus der JSON-Datei.
 */
import {
  ATTRIBUTES,
  EXPERIENCE_LEVELS,
  toInt,
  toNumber,
  dodgeValue,
  initiativeBase,
  experienceLevel,
} from './rules.js';
import { TALENTS, COMBAT_TECHNIQUES, DEFAULT_KTW } from './data/talents.js';
import { createHero, normalizeHero, HeroImportError } from './sheet.js';
import { isPlainObject, newId } from './util.js';

// ---------------------------------------------------------------------------
// Optoliths Nummern (öffentlich im Optolith-Quellcode, src/App/Constants/Ids.ts)
// ---------------------------------------------------------------------------

const ATTRIBUTE_IDS = Object.freeze({
  ATTR_1: 'MU',
  ATTR_2: 'KL',
  ATTR_3: 'IN',
  ATTR_4: 'CH',
  ATTR_5: 'FF',
  ATTR_6: 'GE',
  ATTR_7: 'KO',
  ATTR_8: 'KK',
});

/** TAL_1 … TAL_59 in Optoliths Reihenfolge (wie im Regelwerk). */
const TALENT_IDS = Object.freeze([
  'fliegen',
  'gaukeleien',
  'klettern',
  'koerperbeherrschung',
  'kraftakt',
  'reiten',
  'schwimmen',
  'selbstbeherrschung',
  'singen',
  'sinnesschaerfe',
  'tanzen',
  'taschendiebstahl',
  'verbergen',
  'zechen',
  'bekehren',
  'betoeren',
  'einschuechtern',
  'etikette',
  'gassenwissen',
  'menschenkenntnis',
  'ueberreden',
  'verkleiden',
  'willenskraft',
  'faehrtensuchen',
  'fesseln',
  'fischen',
  'orientierung',
  'pflanzenkunde',
  'tierkunde',
  'wildnisleben',
  'brettspiel',
  'geographie',
  'geschichtswissen',
  'goetter',
  'kriegskunst',
  'magiekunde',
  'mechanik',
  'rechnen',
  'rechtskunde',
  'sagen',
  'sphaerenkunde',
  'sternkunde',
  'alchimie',
  'boote',
  'fahrzeuge',
  'handel',
  'heilkunde_gift',
  'heilkunde_krankheiten',
  'heilkunde_seele',
  'heilkunde_wunden',
  'holzbearbeitung',
  'lebensmittelbearbeitung',
  'lederbearbeitung',
  'malen',
  'metallbearbeitung',
  'musizieren',
  'schloesserknacken',
  'steinbearbeitung',
  'stoffbearbeitung',
]);

/** Kampftechniken; CT_17 (Feuerspeien) gibt es in dieser App nicht. */
const COMBAT_TECHNIQUE_IDS = Object.freeze({
  CT_1: 'armbrueste',
  CT_2: 'boegen',
  CT_3: 'dolche',
  CT_4: 'fechtwaffen',
  CT_5: 'hiebwaffen',
  CT_6: 'kettenwaffen',
  CT_7: 'lanzen',
  CT_8: 'peitschen',
  CT_9: 'raufen',
  CT_10: 'schilde',
  CT_11: 'schleudern',
  CT_12: 'schwerter',
  CT_13: 'stangenwaffen',
  CT_14: 'wurfwaffen',
  CT_15: 'zweihandhiebwaffen',
  CT_16: 'zweihandschwerter',
  CT_18: 'blasrohre',
  CT_19: 'diskusse',
  CT_20: 'faecher',
  CT_21: 'spiesswaffen',
});

/** Kampftechniken aus Optolith, die es in dieser App nicht gibt (nur für die Meldung). */
const OTHER_TECHNIQUE_NAMES = Object.freeze({ CT_17: 'Feuerspeien' });

/** Spezies mit ihren Grundwerten (für die Berechnung, wenn nur die JSON-Datei vorliegt). */
const SPECIES = Object.freeze({
  R_1: { name: 'Menschen', le: 5, sk: -5, zk: -5, gs: 8 },
  R_2: { name: 'Elfen', le: 2, sk: -4, zk: -6, gs: 8 },
  R_3: { name: 'Halbelfen', le: 5, sk: -4, zk: -6, gs: 8 },
  R_4: { name: 'Zwerge', le: 8, sk: -4, zk: -4, gs: 6 },
});

const SOCIAL_STATUS = Object.freeze({ 1: 'Unfrei', 2: 'Frei', 3: 'Niederadel', 4: 'Adel', 5: 'Hochadel' });
const SEX = Object.freeze({ m: 'männlich', f: 'weiblich' });
const REACH = Object.freeze({ 1: 'kurz', 2: 'mittel', 3: 'lang' });
const ROMAN = Object.freeze(['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
const MOTHER_TONGUE_LEVEL = 4;

/** Optoliths Gegenstandsgruppen → Aufbewahrungsort (Rest: am Körper). */
const LOCATION_BY_GROUP = Object.freeze({ 25: 'packtier', 26: 'packtier', 27: 'wagen' });

/** Die vier Listen übernatürlicher Fertigkeiten im Token und ihre Art in dieser App. */
const SPELL_LISTS = Object.freeze([
  ['Zauber', 'zauber'],
  ['Rituale', 'ritual'],
  ['Liturgien', 'liturgie'],
  ['Zeremonien', 'zeremonie'],
]);
const TALENT_GROUP_KEYS = Object.freeze(['Koerper', 'Gesellschaft', 'Natur', 'Wissen', 'Handwerk']);
const SPECIAL_ABILITY_KEYS = Object.freeze(['AllgemeineSF', 'KampfSF', 'MagieSF', 'KlerikaleSF']);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Vergleichbarer Name: „Fährtensuchen“ → „fahrtensuchen“, „Brett- & Glücksspiel“ → „brettglucksspiel“. */
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const TALENT_BY_NAME = new Map(TALENTS.map((talent) => [nameKey(talent.name), talent]));
const TECHNIQUE_BY_NAME = new Map(COMBAT_TECHNIQUES.map((technique) => [nameKey(technique.name), technique]));
const TECHNIQUE_BY_ID = new Map(COMBAT_TECHNIQUES.map((technique) => [technique.id, technique]));

/** „Reich“ + 3 → „Reich III“; Stufe 0 (keine Stufen) bleibt ohne Zusatz. */
export function withLevel(name, level) {
  const value = toInt(level);
  return value > 0 ? `${name} ${ROMAN[value] ?? value}` : name;
}

/** „Eigener Nachteil (Schlechte Angewohnheit …)“ → „Schlechte Angewohnheit …“. */
function unwrapCustom(name) {
  return /^Eigene[rs]? (?:Vorteil|Nachteil|Sonderfertigkeit) \((.*)\)$/.exec(name)?.[1] ?? name;
}

/** Würfel aus Optolith („1d6+1“) in dieser App („1W6+1“), optional mit Schadensbonus. */
export function convertDamage(tp, bonus = 0) {
  const match = /^\s*(\d+)\s*[dw]\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(String(tp ?? ''));
  if (!match) return String(tp ?? '').replace(/d/gi, 'W');
  const flat = toInt(String(match[3] ?? '0').replace(/\s/g, '')) + bonus;
  return `${match[1]}W${match[2]}${flat > 0 ? `+${flat}` : flat < 0 ? flat : ''}`;
}

/** Schadensbonus: +1 TP je Punkt der (besten) Leiteigenschaft über der Schadensschwelle. */
export function damageBonus(thresholds, attributes) {
  const list = Array.isArray(thresholds) ? thresholds : [];
  return Math.max(0, ...list.map((entry) => toInt(attributes[entry?.L]) - toInt(entry?.S, 99)));
}

const text = (value) => (value === undefined || value === null ? '' : String(value).trim());
const entry = (value) => ({ id: newId(), text: value });

// ---------------------------------------------------------------------------
// MapTool-Token (content.xml aus der .rptok)
// ---------------------------------------------------------------------------

const XML_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

function decodeXml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Liest die Eigenschaften eines MapTool-Tokens. Bewusst ohne XML-Parser: Optolith schreibt
 * Sonderzeichen nicht immer korrekt maskiert, ein strenger Parser würde dann ganz scheitern.
 * @returns {{ name: string, properties: Map<string, string> }}
 */
export function parseMapToolToken(xml) {
  const properties = new Map();
  const pattern = /<key>([^<]*)<\/key>\s*<value class="string"(?:\s*\/>|>([\s\S]*?)<\/value>)/g;
  for (const [, key, value = ''] of String(xml).matchAll(pattern)) {
    properties.set(decodeXml(key), decodeXml(value).replace(/<br\s*\/?>/gi, ' '));
  }
  const name = /<net\.rptools\.maptool\.model\.Token>[\s\S]*?<name>([^<]*)<\/name>/.exec(xml)?.[1];
  return { name: decodeXml(name ?? ''), properties };
}

/** Ist das ein von Optolith exportierter Token? */
export function isOptolithToken(token) {
  return token.properties.has('MU') && (token.properties.has('Exporter') || token.properties.has('Koerper'));
}

/** JSON-Wert aus dem Token; Fehlerhaftes wird gemeldet statt den ganzen Import abzubrechen. */
function tokenList(token, key, report) {
  const raw = token?.properties.get(key);
  if (raw === undefined || raw.trim() === '') return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : isPlainObject(value) ? [value] : [];
  } catch {
    report.todo.push(`Der Abschnitt „${key}“ ließ sich nicht lesen – bitte von Hand übertragen.`);
    return [];
  }
}

function tokenObject(token, key) {
  try {
    const value = JSON.parse(token?.properties.get(key) ?? 'null');
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

const tokenNumber = (token, key) => (token?.properties.has(key) ? toInt(token.properties.get(key), null) : null);

// ---------------------------------------------------------------------------
// Optolith-Heldendatei (.json)
// ---------------------------------------------------------------------------

/** Sieht das nach einer Optolith-Heldendatei aus? */
export function isOptolithJson(data) {
  return (
    isPlainObject(data) &&
    typeof data.clientVersion === 'string' &&
    isPlainObject(data.attr) &&
    isPlainObject(data.talents)
  );
}

/** Aktive Einträge (Vorteile, Nachteile, SF) der JSON-Datei: { prefix, id, options[] }. */
function activeEntries(json) {
  const activatable = isPlainObject(json?.activatable) ? json.activatable : {};
  return Object.entries(activatable)
    .filter(([, options]) => Array.isArray(options) && options.length > 0)
    .map(([id, options]) => ({ id, prefix: id.split('_')[0], options }));
}

// ---------------------------------------------------------------------------
// Aufbau des Helden – Schritt für Schritt
// ---------------------------------------------------------------------------

function applyGeneral(hero, { json, token }, report) {
  const general = hero.general;
  general.name = text(json?.name) || text(token?.name) || 'Held aus Optolith';

  const apTotal = tokenNumber(token, 'APgesamt') ?? toInt(json?.ap?.total, null);
  if (apTotal !== null) general.apTotal = apTotal;
  const apSpent = tokenNumber(token, 'APausgegeben');
  if (apSpent !== null) general.apSpent = apSpent;
  else report.todo.push('AP ausgegeben: steht nur in der .rptok-Datei – bitte eintragen.');

  const level = /^EL_(\d+)$/.exec(json?.el ?? '')?.[1];
  general.experience = EXPERIENCE_LEVELS[toInt(level) - 1]?.name ?? experienceLevel(general.apTotal);

  const species = SPECIES[json?.r];
  if (species) general.species = species.name;
  if (json?.p === 'P_0' && text(json.professionName)) general.profession = text(json.professionName);
  const missing = [species ? null : 'Spezies', 'Kultur', general.profession ? null : 'Profession'].filter(Boolean);
  report.todo.push(`${missing.join(', ')}: bitte eintragen (Optolith exportiert dafür keine Namen).`);

  const pers = isPlainObject(json?.pers) ? json.pers : {};
  const appearance = [
    ['Alter', pers.age],
    ['Größe', pers.size],
    ['Gewicht', pers.weight],
  ]
    .filter(([, value]) => text(value))
    .map(([label, value]) => `${label}: ${text(value)}`);
  general.appearance = appearance.join(' · ');
  if (pers.haircolor || pers.eyecolor) report.todo.push('Haar- und Augenfarbe bitte unter „Aussehen“ ergänzen.');

  const notes = [
    ['Familie', pers.family],
    ['Geburtsort', pers.placeofbirth],
    ['Geburtstag', pers.dateofbirth],
    ['Geschlecht', SEX[json?.sex] ?? json?.sex],
    ['Sozialstatus', SOCIAL_STATUS[pers.socialstatus]],
    ['Titel', pers.title],
    ['Charakteristika', pers.characteristics],
    ['Kulturkunde', pers.cultureAreaKnowledge],
    ['Sonstiges', pers.otherinfo],
  ]
    .filter(([, value]) => text(value))
    .map(([label, value]) => `${label}: ${text(value)}`);
  general.notes = notes.join('\n');
}

function applyAttributes(hero, { json, token }) {
  for (const { id, value } of Array.isArray(json?.attr?.values) ? json.attr.values : []) {
    if (ATTRIBUTE_IDS[id]) hero.attributes[ATTRIBUTE_IDS[id]] = toInt(value, hero.attributes[ATTRIBUTE_IDS[id]]);
  }
  for (const code of ATTRIBUTES) {
    const value = tokenNumber(token, code);
    if (value !== null) hero.attributes[code] = value;
  }
}

/** Grundwerte: aus dem Token genau, sonst aus Spezies und Eigenschaften berechnet. */
function applyBaseValues(hero, { json, token }, report) {
  const base = hero.base;
  const { MU, KL, IN, KO, KK, GE } = hero.attributes;
  base.aw = null; // automatisch aus GE, außer Optolith sagt etwas anderes (siehe unten)
  base.ini = null;

  if (token) {
    const pool = (current, max) => {
      const top = tokenNumber(token, max);
      return top === null ? null : { current: tokenNumber(token, current) ?? top, max: top };
    };
    base.le = pool('LeP', 'MaxLeP') ?? base.le;
    base.asp = pool('AsP', 'MaxAsP') ?? { current: 0, max: 0 };
    base.kap = pool('KaP', 'MaxKaP') ?? { current: 0, max: 0 };
    base.schip = pool('SchipsAktuell', 'SchipsMax') ?? base.schip;
    base.sk = tokenNumber(token, 'SK') ?? base.sk;
    base.zk = tokenNumber(token, 'ZK') ?? base.zk;
    base.gs = tokenNumber(token, 'GS') ?? base.gs;
    const aw = tokenNumber(token, 'AW');
    if (aw !== null && aw !== dodgeValue(GE)) base.aw = aw;
    const ini = tokenNumber(token, 'INI');
    if (ini !== null && ini !== initiativeBase(MU, GE)) base.ini = ini;
    report.imported.push('LeP, AsP, KaP, SK, ZK, AW, INI, GS und Schicksalspunkte (wie von Optolith berechnet)');
    return;
  }

  const species = SPECIES[json?.r];
  if (!species) {
    report.todo.push('LeP, AsP, KaP, SK, ZK und GS bitte eintragen (Spezies unbekannt).');
    return;
  }
  const attr = json.attr;
  const le = species.le + 2 * KO + toInt(attr.lp) - toInt(attr.permanentLP?.lost);
  base.le = { current: le, max: le };
  base.asp = { current: 0, max: 0 };
  base.kap = { current: 0, max: 0 };
  base.sk = species.sk + Math.round((MU + KL + IN) / 6);
  base.zk = species.zk + Math.round((KO + KO + KK) / 6);
  base.gs = species.gs;
  report.todo.push(
    'LeP, SK und ZK wurden aus Spezies und Eigenschaften berechnet (ohne Vor-/Nachteile) – bitte prüfen; AsP, KaP und Schicksalspunkte bitte eintragen.',
  );
}

function applyTalents(hero, { json, token }, report) {
  const byId = new Map(hero.talents.map((talent) => [talent.id, talent]));
  if (token) {
    const unknown = [];
    for (const key of TALENT_GROUP_KEYS) {
      for (const item of tokenList(token, key, report)) {
        const talent = byId.get(TALENT_BY_NAME.get(nameKey(item.Talent))?.id);
        if (!talent) {
          if (toInt(item.Talentwert) > 0) unknown.push(`${item.Talent} ${toInt(item.Talentwert)}`);
          continue;
        }
        talent.fw = toInt(item.Talentwert);
        const check = [item.Probe?.Eigenschaft1, item.Probe?.Eigenschaft2, item.Probe?.Eigenschaft3];
        if (check.every((code) => ATTRIBUTES.includes(code))) talent.check = check;
      }
    }
    if (unknown.length) report.todo.push(`Unbekannte Talente (bitte prüfen): ${unknown.join(', ')}.`);
  } else {
    for (const [id, value] of Object.entries(isPlainObject(json?.talents) ? json.talents : {})) {
      const talent = byId.get(TALENT_IDS[toInt(id.replace('TAL_', '')) - 1]);
      if (talent) talent.fw = toInt(value);
    }
  }
  const raised = hero.talents.filter((talent) => talent.fw > 0).length;
  report.imported.push(`${raised} Talente mit Fertigkeitswert`);
}

function applyCombatTechniques(hero, { json, token }, report) {
  const byId = new Map(hero.combatTechniques.map((technique) => [technique.id, technique]));
  const unknown = [];
  const set = (id, name, value) => {
    const technique = byId.get(id);
    if (technique) technique.ktw = toInt(value, DEFAULT_KTW);
    else if (toInt(value, DEFAULT_KTW) !== DEFAULT_KTW) unknown.push(`${name} ${toInt(value)}`);
  };
  if (token) {
    for (const item of tokenList(token, 'Kampftechniken', report)) {
      set(TECHNIQUE_BY_NAME.get(nameKey(item.Name))?.id, item.Name, item.FW);
    }
  } else {
    for (const [id, value] of Object.entries(isPlainObject(json?.ct) ? json.ct : {})) {
      set(COMBAT_TECHNIQUE_IDS[id], OTHER_TECHNIQUE_NAMES[id] ?? id, value);
    }
  }
  if (unknown.length) {
    report.todo.push(`Kampftechniken, die es hier nicht gibt (in den Notizen vermerkt): ${unknown.join(', ')}.`);
    hero.general.notes = [hero.general.notes, `Weitere Kampftechniken: ${unknown.join(', ')}`]
      .filter(Boolean)
      .join('\n');
  }
  const raised = hero.combatTechniques.filter((technique) => technique.ktw !== DEFAULT_KTW).length;
  report.imported.push(`${raised} Kampftechniken über dem Startwert`);
}

/** Vorteile, Nachteile, Sonderfertigkeiten, Sprachen, Schriften, Berufsgeheimnisse, Spezialisierungen. */
function applyAbilities(hero, { json, token }, report) {
  if (!token) {
    const entries = activeEntries(json);
    const custom = (prefix) =>
      entries
        .filter((item) => item.prefix === prefix && item.id.endsWith('_0'))
        .flatMap((item) => item.options.map((option) => text(option.sid)).filter(Boolean));
    hero.advantages = custom('ADV').map(entry);
    hero.disadvantages = custom('DISADV').map(entry);
    hero.specialAbilities = custom('SA').map(entry);
    const unnamed = (prefix) =>
      entries
        .filter((item) => item.prefix === prefix && !item.id.endsWith('_0'))
        .reduce((sum, item) => sum + item.options.length, 0);
    const counts = [
      ['Vorteile', unnamed('ADV')],
      ['Nachteile', unnamed('DISADV')],
      ['Sonderfertigkeiten (inkl. Sprachen, Schriften, Spezialisierungen)', unnamed('SA')],
    ].filter(([, count]) => count > 0);
    if (counts.length) {
      report.todo.push(
        `${counts.map(([label, count]) => `${count} ${label}`).join(', ')}: In der JSON-Datei stehen nur Nummern. Wähle zusätzlich die .rptok-Datei (MapTool-Export) oder trage sie von Hand ein.`,
      );
    }
    return;
  }

  const named = (key) => tokenList(token, key, report).map((item) => ({ name: text(item.Name), level: item.Stufe }));
  hero.advantages = named('Vorteile').map(({ name, level }) => entry(withLevel(unwrapCustom(name), level)));
  hero.disadvantages = named('Nachteile').map(({ name, level }) => entry(withLevel(unwrapCustom(name), level)));

  const heroTalents = new Map(hero.talents.map((talent) => [talent.id, talent]));
  const talentsByName = new Map(TALENTS.map(({ id, name }) => [nameKey(name), heroTalents.get(id)]));
  const specialAbilities = [];
  const languages = [];
  const tradeSecrets = [];
  let specializations = 0;
  for (const { name, level } of SPECIAL_ABILITY_KEYS.flatMap(named)) {
    const language = /^Sprache \((.+)\)$/.exec(name);
    const script = /^Schrift \((.+)\)$/.exec(name);
    const secret = /^Berufsgeheimnis \((.+)\)$/.exec(name);
    const specialization = /^Fertigkeitsspezialisierung \((.+?): (.+)\)$/.exec(name);
    const talent = specialization ? talentsByName.get(nameKey(specialization[1])) : null;
    if (language) {
      languages.push(
        toInt(level) >= MOTHER_TONGUE_LEVEL ? `${language[1]} (Muttersprache)` : withLevel(language[1], level),
      );
    } else if (script) {
      languages.push(`Schrift: ${script[1]}`);
    } else if (secret) {
      tradeSecrets.push(secret[1]);
    } else if (talent) {
      talent.spec = [talent.spec, specialization[2]].filter(Boolean).join(', ');
      specializations += 1;
    } else if (name) {
      specialAbilities.push(withLevel(unwrapCustom(name), level));
    }
  }
  hero.specialAbilities = specialAbilities.map(entry);
  hero.languages = languages.map(entry);
  hero.tradeSecrets = tradeSecrets.map(entry);
  report.imported.push(
    `${hero.advantages.length} Vorteile, ${hero.disadvantages.length} Nachteile, ${specialAbilities.length} Sonderfertigkeiten`,
    `${languages.length} Sprachen & Schriften, ${tradeSecrets.length} Berufsgeheimnisse, ${specializations} Spezialisierungen`,
  );
}

function applySpells(hero, { json, token }, report) {
  if (token) {
    hero.spells = SPELL_LISTS.flatMap(([key, type]) =>
      tokenList(token, key, report).map((item) => ({
        id: newId(),
        name: text(item.Talent),
        type,
        check: [item.Probe?.Eigenschaft1, item.Probe?.Eigenschaft2, item.Probe?.Eigenschaft3],
        fw: toInt(item.Talentwert),
        cost: '',
        castingTime: '',
        range: '',
        duration: '',
        note: text(item.Merkmal) && text(item.Merkmal) !== 'undefined' ? `Merkmal: ${text(item.Merkmal)}` : '',
      })),
    );
    if (hero.spells.length) {
      report.imported.push(`${hero.spells.length} Zauber, Rituale, Liturgien und Zeremonien`);
      report.todo.push(
        'Bei Zaubern und Liturgien bitte Kosten, Dauer und Reichweite ergänzen (exportiert Optolith nicht).',
      );
    }
  } else {
    const count = Object.keys(json?.spells ?? {}).length + Object.keys(json?.liturgies ?? {}).length;
    if (count)
      report.todo.push(
        `${count} Zauber/Liturgien: nur als Nummern in der JSON-Datei – bitte die .rptok-Datei dazu wählen.`,
      );
  }
  const small = [
    ['Zaubertricks', json?.cantrips],
    ['Segnungen', json?.blessings],
  ].filter(([, list]) => Array.isArray(list) && list.length > 0);
  for (const [label, list] of small) {
    report.todo.push(`${list.length} ${label}: bitte von Hand eintragen (Optolith exportiert deren Namen nicht).`);
  }
}

function weaponsFromToken(token, attributes, report) {
  const technique = (name, ranged) => {
    const found = TECHNIQUE_BY_NAME.get(nameKey(name));
    if (found) return found.id;
    report.todo.push(`Waffe mit Kampftechnik „${name}“ – die gibt es hier nicht, bitte prüfen.`);
    return ranged ? 'wurfwaffen' : 'raufen';
  };
  const melee = tokenList(token, 'Nahkampfwaffen', report).map((item) => ({
    id: newId(),
    name: text(item.Name),
    technique: technique(item.Technik, false),
    tp: convertDamage(item.TP, damageBonus(item.LS, attributes)),
    atMod: toInt(item.AT),
    paMod: toInt(item.PA),
    range: REACH[toInt(item.RW)] ?? '',
  }));
  const ranged = tokenList(token, 'Fernkampfwaffen', report).map((item) => ({
    id: newId(),
    name: text(item.Name),
    technique: technique(item.Technik, true),
    tp: convertDamage(item.TP),
    atMod: 0,
    paMod: 0,
    range: [
      [item.RW1, item.RW2, item.RW3].map(toInt).join('/'),
      toInt(item.Ladezeit) > 0 ? `Ladezeit ${toInt(item.Ladezeit)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }));
  return [...melee, ...ranged];
}

function weaponsFromJson(items, attributes) {
  return items
    .filter((item) => COMBAT_TECHNIQUE_IDS[item.combatTechnique] && item.damageDiceNumber)
    .map((item) => {
      const technique = COMBAT_TECHNIQUE_IDS[item.combatTechnique];
      const ranged = TECHNIQUE_BY_ID.get(technique)?.ranged;
      const primary = [item.primaryThreshold?.primary ?? TECHNIQUE_BY_ID.get(technique)?.leading]
        .flat()
        .filter(Boolean);
      const thresholds = [item.primaryThreshold?.threshold].flat().filter((value) => value !== undefined);
      const bonus = ranged
        ? 0
        : damageBonus(
            primary.map((id, index) => ({ L: ATTRIBUTE_IDS[id] ?? id, S: thresholds[index] ?? thresholds[0] })),
            attributes,
          );
      const tp = `${toInt(item.damageDiceNumber)}d${toInt(item.damageDiceSides, 6)}+${toInt(item.damageFlat)}`;
      return {
        id: newId(),
        name: text(item.name),
        technique,
        tp: convertDamage(tp, bonus),
        atMod: ranged ? 0 : toInt(item.at),
        paMod: ranged ? 0 : toInt(item.pa),
        range: ranged ? (Array.isArray(item.range) ? item.range.join('/') : '') : (REACH[toInt(item.reach)] ?? ''),
      };
    });
}

function chooseArmor(armors, report) {
  const real = armors.filter((armor) => armor.rs > 0 || armor.be > 0);
  if (real.length === 0) return { name: '', rs: 0, be: 0 };
  const best = real.reduce((top, armor) => (armor.rs > top.rs ? armor : top));
  if (real.length > 1)
    report.todo.push(
      `Mehrere Rüstungen – übernommen: ${best.name} (RS ${best.rs}). Andere bitte bei Bedarf eintragen.`,
    );
  return best;
}

function applyEquipment(hero, { json, token }, report) {
  const items = Object.values(isPlainObject(json?.belongings?.items) ? json.belongings.items : {}).filter(
    isPlainObject,
  );

  hero.weapons = token ? weaponsFromToken(token, hero.attributes, report) : weaponsFromJson(items, hero.attributes);

  hero.armor = chooseArmor(
    token
      ? tokenList(token, 'Ruestungen', report).map((armor) => ({
          name: text(armor.Name),
          rs: toInt(armor.RS),
          be: toInt(armor.BE),
        }))
      : items
          .filter((item) => item.pro !== undefined)
          .map((item) => ({ name: text(item.name), rs: toInt(item.pro), be: toInt(item.enc) })),
    report,
  );

  if (items.length) {
    hero.inventory = items.map((item) => ({
      id: newId(),
      name: text(item.name),
      count: toNumber(item.amount, 1),
      weight: toNumber(item.weight),
      location: LOCATION_BY_GROUP[item.gr] ?? 'koerper',
      note: '',
    }));
  } else {
    hero.inventory = tokenList(token, 'Inventar', report).map((item) => ({
      id: newId(),
      name: text(item.gegenstand),
      count: toNumber(item.anzahl, 1),
      weight: toNumber(item.gewicht),
      location: 'koerper',
      note: '',
    }));
  }
  if (hero.inventory.length) {
    report.todo.push(
      items.length
        ? 'Aufbewahrungsorte im Inventar bitte anpassen – Tiere und Wagen sind schon einsortiert, der Rest steht unter „Am Körper“.'
        : 'Aufbewahrungsorte im Inventar bitte anpassen – alles steht unter „Am Körper“ (mit der .json-Datei dazu werden Tiere und Wagen einsortiert).',
    );
  }

  const purse = json?.belongings?.purse;
  const misc = tokenObject(token, 'InventarMisc');
  hero.money = purse
    ? { dukaten: toInt(purse.d), silbertaler: toInt(purse.s), heller: toInt(purse.h), kreuzer: toInt(purse.k) }
    : {
        dukaten: toInt(misc?.dukaten),
        silbertaler: toInt(misc?.silbertaler),
        heller: toInt(misc?.heller),
        kreuzer: toInt(misc?.kreuzer),
      };

  report.imported.push(
    `${hero.weapons.length} Waffen, Rüstung: ${hero.armor.name || 'keine'}`,
    `${hero.inventory.length} Gegenstände, Geld: ${hero.money.dukaten} D, ${hero.money.silbertaler} S, ${hero.money.heller} H, ${hero.money.kreuzer} K`,
  );
}

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------

/**
 * Baut aus Optolith-Exporten einen Helden dieser App.
 * @param {object} sources
 * @param {object|null} sources.json   geparste Optolith-Heldendatei
 * @param {object|null} sources.token  Ergebnis von parseMapToolToken
 * @returns {{ hero: object, report: { imported: string[], todo: string[] } }}
 */
export function heroFromOptolith({ json = null, token = null }) {
  if (!json && !token) throw new HeroImportError('Keine Optolith-Daten gefunden.');
  const sources = { json, token };
  const hero = createHero();
  const report = { imported: [], todo: [] };

  applyGeneral(hero, sources, report);
  applyAttributes(hero, sources);
  report.imported.push(`Eigenschaften und AP (${hero.general.apTotal} gesamt)`);
  applyBaseValues(hero, sources, report);
  applyTalents(hero, sources, report);
  applyCombatTechniques(hero, sources, report);
  applyAbilities(hero, sources, report);
  applySpells(hero, sources, report);
  applyEquipment(hero, sources, report);

  return { hero: normalizeHero(hero), report };
}
