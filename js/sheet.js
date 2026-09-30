/**
 * sheet.js – Das Heldenmodell: Standardheld, Prüfen/Reparieren von Daten,
 * Export/Import und abgeleitete Werte. Kein DOM.
 *
 * Aufbau eines Helden (alle Felder JSON-fähig):
 *   general, attributes, base, talents, combatTechniques, weapons, armor,
 *   spells, cantrips, advantages, disadvantages, specialAbilities, languages,
 *   tradeSecrets, inventory, money, conditions, conditionsOff, autoPain
 */
import {
  ATTRIBUTES,
  CONDITIONS,
  COINS,
  INVENTORY_LOCATIONS,
  EXPERIENCE_LEVELS,
  ROMAN_LEVELS,
  toInt,
  toNumber,
  clampConditionLevel,
  effectiveConditionLevels,
  conditionPenalty,
  attackValue,
  parryValue,
  rangedValue,
  dodgeValue,
  initiativeBase,
} from './rules.js';
import { TALENTS, COMBAT_TECHNIQUES, DEFAULT_KTW, SPELL_TYPES } from './data/talents.js';
import { newId, isPlainObject } from './util.js';

export const HERO_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = 'dsa5-held';

/** Listen mit einfachen Texteinträgen { id, text }. */
export const TEXT_LISTS = Object.freeze([
  { key: 'advantages', name: 'Vorteile', single: 'Vorteil' },
  { key: 'disadvantages', name: 'Nachteile', single: 'Nachteil' },
  { key: 'specialAbilities', name: 'Sonderfertigkeiten', single: 'Sonderfertigkeit' },
  { key: 'languages', name: 'Sprachen & Schriften', single: 'Sprache / Schrift' },
  { key: 'tradeSecrets', name: 'Berufsgeheimnisse', single: 'Berufsgeheimnis' },
]);

/** Fehler beim Import; die Nachricht ist für Menschen gedacht. */
export class HeroImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeroImportError';
  }
}

// ---------------------------------------------------------------------------
// Neue Einträge
// ---------------------------------------------------------------------------

function pool(current, max) {
  return { current, max };
}

/** Ein neuer, leerer Held mit allen Talenten und Kampftechniken. */
export function createHero() {
  return {
    schema: HERO_SCHEMA_VERSION,
    general: {
      name: '',
      species: '',
      culture: '',
      profession: '',
      experience: 'Erfahren',
      apTotal: 1100,
      apSpent: 0,
      appearance: '',
      notes: '',
    },
    attributes: Object.fromEntries(ATTRIBUTES.map((code) => [code, 10])),
    base: {
      le: pool(25, 25),
      asp: pool(0, 0),
      kap: pool(0, 0),
      sk: 0,
      zk: 0,
      aw: null, // null = automatisch aus GE
      ini: null, // null = automatisch aus MU und GE
      gs: 8,
      schip: pool(3, 3),
    },
    talents: TALENTS.map(({ id, check }) => ({ id, check: [...check], fw: 0, spec: '' })),
    combatTechniques: COMBAT_TECHNIQUES.map(({ id }) => ({ id, ktw: DEFAULT_KTW, at: null, pa: null, fk: null })),
    weapons: [],
    armor: { name: '', rs: 0, be: 0 },
    spells: [],
    cantrips: [],
    ...Object.fromEntries(TEXT_LISTS.map(({ key }) => [key, []])),
    inventory: [],
    money: Object.fromEntries(COINS.map(({ id }) => [id, 0])),
    conditions: Object.fromEntries(CONDITIONS.map(({ id }) => [id, 0])),
    conditionsOff: Object.fromEntries(CONDITIONS.map(({ id }) => [id, false])),
    autoPain: false,
  };
}

export function createWeapon() {
  return { id: newId(), name: '', technique: 'schwerter', tp: '1W6+4', atMod: 0, paMod: 0, range: '' };
}

export function createSpell() {
  return {
    id: newId(),
    name: '',
    type: 'zauber',
    check: ['MU', 'KL', 'IN'],
    fw: 0,
    cost: '',
    castingTime: '',
    range: '',
    duration: '',
    note: '',
  };
}

export function createTextEntry() {
  return { id: newId(), text: '' };
}

export function createItem() {
  return { id: newId(), name: '', count: 1, weight: 0, location: INVENTORY_LOCATIONS[0].id, note: '' };
}

// ---------------------------------------------------------------------------
// Daten prüfen und reparieren (für Import, lokale Daten und später Serverdaten)
// ---------------------------------------------------------------------------

function text(value, fallback = '') {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function optionalInt(value) {
  return value === null || value === undefined || value === '' ? null : toInt(value, null);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeCheck(check, fallback) {
  const list = Array.isArray(check) ? check : [];
  return fallback.map((defaultCode, index) => oneOf(list[index], ATTRIBUTES, defaultCode));
}

function normalizePool(value, fallback) {
  const source = isPlainObject(value) ? value : {};
  return { current: toInt(source.current, fallback.current), max: toInt(source.max, fallback.max) };
}

/** Normalisiert eine Liste; Einträge ohne gültige ID bekommen eine neue. */
function normalizeList(list, normalizeEntry) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(isPlainObject).map((entry) => {
    const id = typeof entry.id === 'string' && entry.id && !seen.has(entry.id) ? entry.id : newId();
    seen.add(id);
    return { id, ...normalizeEntry(entry) };
  });
}

/** Führt gespeicherte Werte mit einer festen Stammliste (Talente, Kampftechniken) zusammen. */
function mergeById(stored, defaults, mergeEntry) {
  const byId = new Map((Array.isArray(stored) ? stored : []).filter(isPlainObject).map((entry) => [entry.id, entry]));
  return defaults.map((entry) => mergeEntry(entry, byId.get(entry.id) ?? {}));
}

const TECHNIQUE_IDS = COMBAT_TECHNIQUES.map(({ id }) => id);
const SPELL_TYPE_IDS = SPELL_TYPES.map(({ id }) => id);
const LOCATION_IDS = INVENTORY_LOCATIONS.map(({ id }) => id);
const EXPERIENCE_NAMES = EXPERIENCE_LEVELS.map(({ name }) => name);

/**
 * Macht aus beliebigen (auch fehlerhaften) Daten einen vollständigen, gültigen Helden.
 * Fehlende Felder werden ergänzt, falsche Typen korrigiert, Unbekanntes verworfen.
 */
export function normalizeHero(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const hero = createHero();
  const general = isPlainObject(source.general) ? source.general : {};
  const attributes = isPlainObject(source.attributes) ? source.attributes : {};
  const base = isPlainObject(source.base) ? source.base : {};

  for (const key of ['name', 'species', 'culture', 'profession', 'appearance', 'notes']) {
    hero.general[key] = text(general[key]);
  }
  hero.general.experience = oneOf(general.experience, EXPERIENCE_NAMES, hero.general.experience);
  hero.general.apTotal = toInt(general.apTotal, hero.general.apTotal);
  hero.general.apSpent = toInt(general.apSpent, hero.general.apSpent);

  for (const code of ATTRIBUTES) hero.attributes[code] = toInt(attributes[code], hero.attributes[code]);

  for (const key of ['le', 'asp', 'kap', 'schip']) hero.base[key] = normalizePool(base[key], hero.base[key]);
  for (const key of ['sk', 'zk', 'gs']) hero.base[key] = toInt(base[key], hero.base[key]);
  hero.base.aw = optionalInt(base.aw);
  hero.base.ini = optionalInt(base.ini);

  hero.talents = mergeById(source.talents, TALENTS, (talent, stored) => ({
    id: talent.id,
    check: normalizeCheck(stored.check, talent.check),
    fw: toInt(stored.fw),
    spec: text(stored.spec),
  }));

  hero.combatTechniques = mergeById(source.combatTechniques, COMBAT_TECHNIQUES, ({ id }, stored) => ({
    id,
    ktw: toInt(stored.ktw, DEFAULT_KTW),
    at: optionalInt(stored.at),
    pa: optionalInt(stored.pa),
    fk: optionalInt(stored.fk),
  }));

  hero.weapons = normalizeList(source.weapons, (weapon) => ({
    name: text(weapon.name),
    technique: oneOf(weapon.technique, TECHNIQUE_IDS, 'schwerter'),
    tp: text(weapon.tp, '1W6'),
    atMod: toInt(weapon.atMod),
    paMod: toInt(weapon.paMod),
    range: text(weapon.range),
  }));

  const armor = isPlainObject(source.armor) ? source.armor : {};
  hero.armor = { name: text(armor.name), rs: toInt(armor.rs), be: toInt(armor.be) };

  hero.spells = normalizeList(source.spells, (spell) => ({
    name: text(spell.name),
    type: oneOf(spell.type, SPELL_TYPE_IDS, 'zauber'),
    check: normalizeCheck(spell.check, ['MU', 'KL', 'IN']),
    fw: toInt(spell.fw),
    cost: text(spell.cost),
    castingTime: text(spell.castingTime),
    range: text(spell.range),
    duration: text(spell.duration),
    note: text(spell.note),
  }));

  const textEntry = (entry) => ({ text: text(entry.text) });
  hero.cantrips = normalizeList(source.cantrips, textEntry);
  for (const { key } of TEXT_LISTS) hero[key] = normalizeList(source[key], textEntry);

  hero.inventory = normalizeList(source.inventory, (item) => ({
    name: text(item.name),
    count: toNumber(item.count, 1),
    weight: toNumber(item.weight),
    location: oneOf(item.location, LOCATION_IDS, LOCATION_IDS[0]),
    note: text(item.note),
  }));

  const money = isPlainObject(source.money) ? source.money : {};
  for (const { id } of COINS) hero.money[id] = Math.max(0, toInt(money[id]));

  const conditions = isPlainObject(source.conditions) ? source.conditions : {};
  const conditionsOff = isPlainObject(source.conditionsOff) ? source.conditionsOff : {};
  for (const { id } of CONDITIONS) {
    hero.conditions[id] = clampConditionLevel(conditions[id]);
    hero.conditionsOff[id] = conditionsOff[id] === true;
  }
  hero.autoPain = source.autoPain === true;

  return hero;
}

// ---------------------------------------------------------------------------
// Export & Import
// ---------------------------------------------------------------------------

/** JSON-Text für die Sicherungsdatei. */
export function exportHero(hero) {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: HERO_SCHEMA_VERSION, exportedAt: new Date().toISOString(), hero },
    null,
    2,
  );
}

/** Liest eine Sicherungsdatei (oder rohes Helden-JSON) ein. Wirft HeroImportError. */
export function importHero(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new HeroImportError('Die Datei ist kein gültiges JSON. Bitte eine exportierte Helden-Datei wählen.');
  }
  const candidate = isPlainObject(data) && data.format === EXPORT_FORMAT ? data.hero : data;
  const looksLikeHero =
    isPlainObject(candidate) && (isPlainObject(candidate.general) || isPlainObject(candidate.attributes));
  if (!looksLikeHero) {
    throw new HeroImportError('In der Datei wurde kein DSA5-Held gefunden.');
  }
  return normalizeHero(candidate);
}

// ---------------------------------------------------------------------------
// Nachschlagen & abgeleitete Werte
// ---------------------------------------------------------------------------

const TALENT_BY_ID = new Map(TALENTS.map((talent) => [talent.id, talent]));
const TECHNIQUE_BY_ID = new Map(COMBAT_TECHNIQUES.map((technique) => [technique.id, technique]));
const SPELL_TYPE_BY_ID = new Map(SPELL_TYPES.map((type) => [type.id, type]));

export function talentInfo(id) {
  return TALENT_BY_ID.get(id);
}

export function techniqueInfo(id) {
  return TECHNIQUE_BY_ID.get(id);
}

export function spellTypeInfo(id) {
  return SPELL_TYPE_BY_ID.get(id) ?? SPELL_TYPES[0];
}

export function heroName(hero) {
  return hero.general.name.trim() || 'Unbenannter Held';
}

export function attributeValue(hero, code) {
  return toInt(hero.attributes[code]);
}

/** Eigenschaftswerte zu einer Probe, z. B. ['MU','GE','KK'] → [12, 13, 11]. */
export function checkValues(hero, check) {
  return check.map((code) => attributeValue(hero, code));
}

/** „MU/GE/KK (12/13/11)“ */
export function describeCheck(hero, check) {
  return `${check.join('/')} (${checkValues(hero, check).join('/')})`;
}

export function dodgeOf(hero) {
  return hero.base.aw ?? dodgeValue(attributeValue(hero, 'GE'));
}

export function initiativeBaseOf(hero) {
  return hero.base.ini ?? initiativeBase(attributeValue(hero, 'MU'), attributeValue(hero, 'GE'));
}

/** Automatisch berechnete Werte einer Kampftechnik (ohne manuelle Anpassung). */
export function computedTechniqueValues(hero, entry) {
  const info = techniqueInfo(entry.id);
  if (info.ranged) return { at: null, pa: null, fk: rangedValue(entry.ktw, attributeValue(hero, 'FF')) };
  const leading = info.leading.map((code) => attributeValue(hero, code));
  return { at: attackValue(entry.ktw, attributeValue(hero, 'MU')), pa: parryValue(entry.ktw, leading), fk: null };
}

/** Gültige Werte einer Kampftechnik: manuelle Werte haben Vorrang vor berechneten. */
export function techniqueValues(hero, entry) {
  const computed = computedTechniqueValues(hero, entry);
  const pick = (key) => (computed[key] === null ? null : (entry[key] ?? computed[key]));
  return { at: pick('at'), pa: pick('pa'), fk: pick('fk') };
}

/** AT/PA bzw. FK einer Waffe inklusive Waffenmodifikatoren. */
export function weaponValues(hero, weapon) {
  const entry = hero.combatTechniques.find(({ id }) => id === weapon.technique) ?? hero.combatTechniques[0];
  const info = techniqueInfo(entry.id);
  const values = techniqueValues(hero, entry);
  if (info.ranged) return { ranged: true, techniqueName: info.name, fk: values.fk + toInt(weapon.atMod) };
  return {
    ranged: false,
    techniqueName: info.name,
    at: values.at + toInt(weapon.atMod),
    pa: values.pa + toInt(weapon.paMod),
  };
}

/** Zustände inklusive automatischem Schmerz und Gesamtabzug für Proben. */
export function conditionState(hero) {
  const levels = effectiveConditionLevels(hero.conditions, {
    autoPain: hero.autoPain,
    le: hero.base.le.current,
    leMax: hero.base.le.max,
  });
  const active = CONDITIONS.filter(({ id }) => levels[id] > 0).map(({ id, name }) => ({
    id,
    name,
    level: levels[id],
    off: hero.conditionsOff[id],
  }));
  return { levels, active, penalty: conditionPenalty(levels, hero.conditionsOff) };
}

/** Kurzbeschreibung aktiver Zustände, z. B. „Schmerz II, Furcht I (aus)“. */
export function describeConditions(hero) {
  return conditionState(hero)
    .active.map(({ name, level, off }) => `${name} ${ROMAN_LEVELS[level]}${off ? ' (aus)' : ''}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Änderungen am Helden
// ---------------------------------------------------------------------------

/**
 * Zieht AsP oder KaP ab, aber nie unter 0.
 * Liefert die tatsächlich abgezogene Menge (für „Rückgängig“).
 */
export function payEnergy(hero, resource, amount) {
  const energy = hero.base[resource];
  const paid = Math.min(Math.max(0, toInt(amount)), Math.max(0, toInt(energy.current)));
  energy.current = toInt(energy.current) - paid;
  return paid;
}

export function refundEnergy(hero, resource, amount) {
  const energy = hero.base[resource];
  energy.current = toInt(energy.current) + Math.max(0, toInt(amount));
}

/** Setzt einen Schicksalspunkt ein. Liefert false, wenn keiner mehr übrig ist. */
export function spendFatePoint(hero) {
  const schip = hero.base.schip;
  if (toInt(schip.current) <= 0) return false;
  schip.current = toInt(schip.current) - 1;
  return true;
}
