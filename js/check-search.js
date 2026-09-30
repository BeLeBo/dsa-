/**
 * check-search.js – Proben schnell finden (Karte → „Probe“): Eigenschaften, Talente, Kampf
 * (Waffen, Kampftechniken, Ausweichen, Initiative), Zauber und Liturgien.
 * Rein (kein DOM). Die Probenbeschreibungen sind dieselben wie bei den Knöpfen im Heldenbogen
 * (siehe ui/roll-actions.js) und gehen in denselben Probendialog.
 */
import { ATTRIBUTES, ATTRIBUTE_NAMES } from './rules.js';
import {
  talentInfo,
  techniqueInfo,
  spellTypeInfo,
  describeCheck,
  attributeValue,
  dodgeOf,
  initiativeBaseOf,
  weaponValues,
  techniqueValues,
} from './sheet.js';

/** Höchstens so viele Treffer werden angezeigt. */
export const MAX_RESULTS = 12;
/** So viele zuletzt gewürfelte Proben merkt sich das Gerät. */
export const MAX_RECENT = 6;

const COMBAT_KEYS = Object.freeze({ at: 'AT', pa: 'PA', fk: 'FK' });

/**
 * Suchschlüssel: klein, ohne Umlaute und Akzente – „Körperbeherrschung“ findet man mit „körper“,
 * „korper“ oder „koerper“ (ae/oe/ue wird wie ä/ö/ü behandelt, auf beiden Seiten gleich).
 */
export function searchKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/([aou])e/g, '$1')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Eindeutiger Schlüssel einer Probe (für „zuletzt gewürfelt“). */
export function specKey(spec) {
  return [spec.kind, spec.id ?? spec.code ?? '', spec.value ?? ''].join(':');
}

const valueText = (value) => (value === null || value === undefined ? '–' : String(value));

function weaponChoices(hero) {
  return hero.weapons.flatMap((weapon) => {
    const values = weaponValues(hero, weapon);
    const name = String(weapon.name ?? '').trim() || 'Waffe';
    const keys = values.ranged ? ['fk'] : ['at', 'pa'];
    return keys.map((key) => ({
      group: 'Waffe',
      name: `${name} ${COMBAT_KEYS[key]}`,
      sub: `${COMBAT_KEYS[key]} ${valueText(values[key])}`,
      chip: `${name} ${COMBAT_KEYS[key]} ${valueText(values[key])}`,
      spec: { kind: 'weapon', id: weapon.id, value: key },
    }));
  });
}

function techniqueChoices(hero) {
  return hero.combatTechniques.flatMap((entry) => {
    const info = techniqueInfo(entry.id);
    if (!info) return [];
    const values = techniqueValues(hero, entry);
    const keys = info.ranged ? ['fk'] : ['at', 'pa'];
    return keys.map((key) => ({
      group: 'Kampftechnik',
      name: `${info.name} ${COMBAT_KEYS[key]}`,
      sub: `${COMBAT_KEYS[key]} ${valueText(values[key])}`,
      spec: { kind: 'technique', id: entry.id, value: key },
    }));
  });
}

/**
 * Alle Proben eines Helden.
 * @returns {{ group: string, name: string, sub: string, chip?: string, spec: object }[]}
 *          chip = kurze Beschriftung für die Schnellwahl (z. B. „MU 12“)
 */
export function checkChoices(hero) {
  const attributes = ATTRIBUTES.map((code) => ({
    group: 'Eigenschaft',
    name: ATTRIBUTE_NAMES[code],
    sub: `${code} ${attributeValue(hero, code)}`,
    chip: `${code} ${attributeValue(hero, code)}`,
    spec: { kind: 'attribute', code },
  }));
  const talents = hero.talents
    .filter((talent) => talentInfo(talent.id))
    .map((talent) => ({
      group: 'Talent',
      name: talentInfo(talent.id).name,
      sub: `${describeCheck(hero, talent.check)} · FW ${talent.fw}`,
      spec: { kind: 'talent', id: talent.id },
    }));
  const combat = [
    {
      group: 'Kampf',
      name: 'Ausweichen',
      sub: `AW ${dodgeOf(hero)}`,
      chip: `AW ${dodgeOf(hero)}`,
      spec: { kind: 'dodge' },
    },
    {
      group: 'Kampf',
      name: 'Initiative',
      sub: `INI ${initiativeBaseOf(hero)} + 1W6`,
      chip: `INI ${initiativeBaseOf(hero)}`,
      spec: { kind: 'initiative' },
    },
  ];
  const spells = hero.spells.map((spell) => ({
    group: spellTypeInfo(spell.type).name,
    name: String(spell.name ?? '').trim() || 'Neuer Eintrag',
    sub: `${describeCheck(hero, spell.check)} · FW ${spell.fw}`,
    spec: { kind: 'spell', id: spell.id },
  }));
  return [...attributes, ...talents, ...combat, ...weaponChoices(hero), ...spells, ...techniqueChoices(hero)];
}

/** Ohne Suchbegriff: Eigenschaften, Ausweichen, Initiative und die Waffen des Helden. */
export function quickChoices(hero) {
  return checkChoices(hero).filter((choice) => ['Eigenschaft', 'Kampf', 'Waffe'].includes(choice.group));
}

/**
 * Sucht Proben nach Namen (und Art, z. B. „Zauber“). Treffer am Wortanfang zuerst,
 * sonst in der Reihenfolge des Heldenbogens.
 */
export function searchChecks(choices, query, limit = MAX_RESULTS) {
  const needle = searchKey(query).trim();
  if (!needle) return [];
  const scored = [];
  choices.forEach((choice, index) => {
    const name = searchKey(choice.name);
    let score;
    if (name.startsWith(needle)) score = 0;
    else if (name.split(/[\s/-]+/).some((word) => word.startsWith(needle))) score = 1;
    else if (name.includes(needle)) score = 2;
    else if (searchKey(choice.group).startsWith(needle)) score = 3;
    else return;
    scored.push({ choice, score, index });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ choice }) => choice);
}

/** Zuletzt gewürfelte Proben, die es beim Helden (noch) gibt – neueste zuerst. */
export function recentChoices(choices, recentKeys) {
  const byKey = new Map(choices.map((choice) => [specKey(choice.spec), choice]));
  return recentKeys.map((key) => byKey.get(key)).filter(Boolean);
}

/** Merkt sich eine gewürfelte Probe (vorne, ohne Doppelte, höchstens MAX_RECENT). */
export function rememberRecent(recentKeys, spec) {
  const key = specKey(spec);
  return [key, ...recentKeys.filter((entry) => entry !== key)].slice(0, MAX_RECENT);
}
