/**
 * sheet.js – Das Heldenmodell: Standardheld, Prüfen/Reparieren von Daten,
 * Export/Import und abgeleitete Werte. Kein DOM.
 *
 * Aufbau eines Helden (alle Felder JSON-fähig):
 *   general, attributes, base, talents, combatTechniques, weapons, armor,
 *   spells, cantrips, advantages, disadvantages, specialAbilities, languages,
 *   tradeSecrets, inventoryGroups, inventory, money, conditions, conditionsOff, autoPain, favorites
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
  painLevelFromLe,
  habituationLevel,
  armorEncumbrance,
  MAX_CONDITION_PENALTY,
  attackValue,
  parryValue,
  rangedValue,
  dodgeValue,
  initiativeBase,
} from './rules.js';
import { TALENTS, COMBAT_TECHNIQUES, DEFAULT_KTW, SPELL_TYPES } from './data/talents.js';
import { newId, isPlainObject } from './util.js';

export const HERO_SCHEMA_VERSION = 1;
/** Höchstens so viele Lieblingsproben je Held. */
export const MAX_FAVORITES = 30;
export const EXPORT_FORMAT = 'dsa5-held';

/** Listen mit einfachen Texteinträgen { id, text, note } (note: eigene Beschreibung hinter dem „i“). */
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
    armor: { name: '', rs: 0, be: 0, extra: false, note: '' },
    spells: [],
    cantrips: [],
    ...Object.fromEntries(TEXT_LISTS.map(({ key }) => [key, []])),
    inventoryGroups: defaultInventoryGroups(), // eigene Gruppen; Gegenstände verweisen per location darauf
    inventory: [],
    money: Object.fromEntries(COINS.map(({ id }) => [id, 0])),
    conditions: Object.fromEntries(CONDITIONS.map(({ id }) => [id, 0])),
    conditionsOff: Object.fromEntries(CONDITIONS.map(({ id }) => [id, false])),
    autoPain: false,
    favorites: [], // Lieblingsproben (Schlüssel wie in check-search.js), z. B. die Angriffe für den Kampf
  };
}

export function createWeapon() {
  return { id: newId(), name: '', technique: 'schwerter', tp: '1W6+4', atMod: 0, paMod: 0, range: '', note: '' };
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

/** Texteintrag (Vorteil, Zaubertrick …) – note ist die eigene Beschreibung hinter dem „i“. */
export function createTextEntry() {
  return { id: newId(), text: '', note: '' };
}

/** Neuer Gegenstand – in der angegebenen Inventar-Gruppe. */
export function createItem(location = INVENTORY_LOCATIONS[0].id) {
  return { id: newId(), name: '', count: 1, weight: 0, location, note: '' };
}

/** So viele Inventar-Gruppen hat ein Held höchstens; so lang darf ein Gruppenname sein. */
export const MAX_INVENTORY_GROUPS = 20;
export const MAX_GROUP_NAME_LENGTH = 40;

/** Startgruppen: Am Körper, Rucksack, Wagen, Packtier (IDs wie die früheren festen Orte). */
export function defaultInventoryGroups() {
  return INVENTORY_LOCATIONS.map(({ id, name }) => ({ id, name }));
}

export function createInventoryGroup(name = 'Neue Gruppe') {
  return { id: newId(), name };
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

const sum = (values) => values.reduce((total, value) => total + value, 0);

const TECHNIQUE_IDS = COMBAT_TECHNIQUES.map(({ id }) => id);
const SPELL_TYPE_IDS = SPELL_TYPES.map(({ id }) => id);
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
    note: text(weapon.note),
  }));

  const armor = isPlainObject(source.armor) ? source.armor : {};
  // extra: zusätzliche Abzüge der Rüstung (−1 GS, −1 INI), z. B. bei Leder- und Schuppenrüstung
  hero.armor = {
    name: text(armor.name),
    rs: toInt(armor.rs),
    be: Math.max(0, toInt(armor.be)),
    extra: armor.extra === true,
    note: text(armor.note),
  };

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

  const textEntry = (entry) => ({ text: text(entry.text), note: text(entry.note) });
  hero.cantrips = normalizeList(source.cantrips, textEntry);
  for (const { key } of TEXT_LISTS) hero[key] = normalizeList(source[key], textEntry);

  // Ältere Helden kennen nur die festen Orte – sie bekommen die Startgruppen mit denselben IDs.
  const groups = normalizeList(source.inventoryGroups, (group) => ({
    name: text(group.name).trim().slice(0, MAX_GROUP_NAME_LENGTH),
  })).slice(0, MAX_INVENTORY_GROUPS);
  hero.inventoryGroups = groups.length ? groups : defaultInventoryGroups();
  const groupIds = hero.inventoryGroups.map(({ id }) => id);
  hero.inventory = normalizeList(source.inventory, (item) => ({
    name: text(item.name),
    count: toNumber(item.count, 1),
    weight: toNumber(item.weight),
    location: oneOf(item.location, groupIds, groupIds[0]), // Gruppe weg → erste Gruppe
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
  hero.favorites = Array.isArray(source.favorites)
    ? [...new Set(source.favorites.filter((key) => typeof key === 'string' && key.length <= 80))].slice(
        0,
        MAX_FAVORITES,
      )
    : [];

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

/**
 * Rüstung: Belastungsstufen (BE, mit Belastungsgewöhnung aus den Sonderfertigkeiten) und ob die
 * zusätzlichen Abzüge (−1 GS, −1 INI) gelten.
 */
export function armorState(hero) {
  const habituation = habituationLevel(hero.specialAbilities);
  const { levels, extra } = armorEncumbrance(hero.armor, habituation);
  return { name: hero.armor.name, be: hero.armor.be, habituation, levels, extra };
}

/**
 * Erschwert Belastung diese Probe? Offiziell (Regelwerk S. 32): Talente mit „Belastung: ja“,
 * Angriff (auch Fernkampf), Verteidigung (Parade, Ausweichen) und Initiative – nicht aber
 * Eigenschaftsproben, Zauber, Liturgien oder Schaden.
 * @param {object} spec  Probenbeschreibung wie im Probendialog, z. B. { kind: 'talent', id: 'klettern' }
 */
export function encumbranceAppliesTo(spec) {
  switch (spec?.kind) {
    case 'talent':
      return talentInfo(spec.id)?.encumbrance === true;
    case 'dodge':
    case 'technique':
    case 'weapon':
    case 'initiative':
      return true;
    default:
      return false;
  }
}

/**
 * Zustände inklusive automatischem Schmerz (aus LE) und Belastung (aus der Rüstung) und Gesamtabzug.
 * @param {{ encumbrance?: boolean }} [options]  zählt Belastung mit? (siehe encumbranceAppliesTo)
 */
export function conditionState(hero, { encumbrance = true } = {}) {
  const armor = armorState(hero);
  const levels = effectiveConditionLevels(hero.conditions, {
    autoPain: hero.autoPain,
    le: hero.base.le.current,
    leMax: hero.base.le.max,
    armorLevels: armor.levels,
  });
  const fromLe = hero.autoPain ? painLevelFromLe(hero.base.le.current, hero.base.le.max) : 0;
  const active = CONDITIONS.filter(({ id }) => levels[id] > 0).map(({ id, name }) => ({
    id,
    name,
    level: levels[id],
    off: hero.conditionsOff[id],
    // Woher die Stufen kommen (für die Aufschlüsselung): automatisch aus LE bzw. aus der Rüstung
    auto: id === 'schmerz' ? Math.min(levels[id], fromLe) : id === 'belastung' ? Math.min(levels[id], armor.levels) : 0,
  }));
  const ignored = encumbrance ? hero.conditionsOff : { ...hero.conditionsOff, belastung: true };
  return { levels, active, armor, penalty: conditionPenalty(levels, ignored) };
}

/** Kurzbeschreibung aktiver Zustände, z. B. „Schmerz II, Belastung I (Rüstung), Furcht I (aus)“. */
export function describeConditions(hero) {
  return conditionState(hero)
    .active.map(({ id, name, level, off, auto }) => {
      const source = id === 'belastung' && auto === level ? ' (Rüstung)' : '';
      return `${name} ${ROMAN_LEVELS[level]}${source}${off ? ' (aus)' : ''}`;
    })
    .join(', ');
}

/** Woher die Stufen eines Zustands kommen, z. B. „I aus LE + I eingetragen“. */
function conditionSource(entry, armor) {
  if (!entry.auto) return '';
  const manual = entry.level - entry.auto;
  const auto =
    entry.id === 'schmerz'
      ? `${ROMAN_LEVELS[entry.auto]} aus LE`
      : `${ROMAN_LEVELS[entry.auto]} aus Rüstung (BE ${armor.be}${
          armor.habituation ? `, Belastungsgewöhnung ${ROMAN_LEVELS[armor.habituation]}` : ''
        })`;
  return manual > 0 ? `${auto} + ${ROMAN_LEVELS[manual]} eingetragen` : auto;
}

/**
 * Erleichterungen und Erschwernisse einer Probe, aufgeschlüsselt: jeder Zustand einzeln (Belastung nur,
 * wo sie offiziell zählt), bei der Initiative die zusätzlichen Abzüge der Rüstung, dazu der eigene
 * Modifikator. Jede Zeile lässt sich im Probendialog an- und abschalten (choices).
 * @param {object} hero
 * @param {object} spec     Probenbeschreibung, z. B. { kind: 'talent', id: 'klettern' }
 * @param {{ manual?: number, choices?: Record<string, boolean> }} [options]
 *        choices: Zeilen-ID → an/aus (überschreibt die Vorgabe)
 * @returns {{ parts: object[], conditions: number, capped: boolean, manual: number, total: number }}
 */
export function modifierBreakdown(hero, spec, { manual = 0, choices = {} } = {}) {
  const encumbrance = encumbranceAppliesTo(spec);
  const initiative = spec?.kind === 'initiative';
  const { active, armor } = conditionState(hero);
  const parts = [];
  for (const entry of active) {
    // Initiative: nur Belastung (INI −1 je Stufe); Schaden: keine Zustände
    if (spec?.kind === 'damage' || (initiative && entry.id !== 'belastung')) continue;
    const applies = entry.id !== 'belastung' || encumbrance;
    const byDefault = applies && !entry.off;
    const notes = [conditionSource(entry, armor)];
    if (entry.off) notes.push('im Heldenbogen auf „ignorieren“');
    if (!applies) notes.push('zählt bei dieser Probe offiziell nicht');
    parts.push({
      id: entry.id,
      kind: 'condition',
      label: `${entry.name} ${ROMAN_LEVELS[entry.level]}`,
      detail: notes.filter(Boolean).join(' · '),
      value: -entry.level,
      byDefault,
      active: choices[entry.id] ?? byDefault,
    });
  }
  if (initiative && armor.extra) {
    parts.push({
      id: 'ruestung',
      kind: 'armor',
      label: 'Rüstung: zusätzlicher Abzug',
      detail: `${armor.name || 'Rüstung'} (INI −1)`,
      value: -1,
      byDefault: true,
      active: choices.ruestung ?? true,
    });
  }
  const conditionSum = sum(parts.filter((part) => part.kind === 'condition' && part.active).map((part) => part.value));
  const conditions = Math.max(-MAX_CONDITION_PENALTY, conditionSum);
  const others = sum(parts.filter((part) => part.kind !== 'condition' && part.active).map((part) => part.value));
  const own = toInt(manual);
  return {
    parts,
    conditions,
    capped: conditionSum < -MAX_CONDITION_PENALTY,
    manual: own,
    total: conditions + others + own,
  };
}

/**
 * Bewegungs- und Initiativewerte mit Rüstung: GS und INI je −1 pro Belastungsstufe, dazu die
 * zusätzlichen Abzüge der Rüstung (Regel-Wiki „Rüstung und Belastung“).
 */
export function armorPenalties(hero) {
  const { levels, armor } = conditionState(hero);
  // Belastung IV heißt handlungsunfähig – für GS und INI zählen höchstens drei Stufen
  const encumbrance = hero.conditionsOff.belastung ? 0 : Math.min(levels.belastung, 3);
  const penalty = encumbrance + (armor.extra ? 1 : 0);
  return { gs: penalty, ini: penalty, encumbrance, extra: armor.extra };
}

/** Listen mit Einträgen, die im Bogen als eigene Zeilen erscheinen. */
const ENTRY_LISTS = [
  'weapons',
  'spells',
  'cantrips',
  ...TEXT_LISTS.map(({ key }) => key),
  'inventoryGroups',
  'inventory',
];

/**
 * Kennung des Aufbaus: welche Einträge es gibt und welche Waffen Nah- bzw. Fernkampf sind.
 * Ändert sie sich (z. B. durch eine Änderung des Meisters), werden die Listen neu aufgebaut.
 */
export function structureSignature(hero) {
  if (!hero) return '';
  return JSON.stringify([
    ...ENTRY_LISTS.map((key) => hero[key].map((entry) => entry.id)),
    hero.weapons.map((weapon) => weapon.technique),
    // Inventar ist nach Gruppen geordnet: Umsortieren und Umbenennen bauen es neu auf.
    hero.inventory.map((item) => item.location),
    hero.inventoryGroups.map((group) => group.name),
  ]);
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
