/**
 * derived.js – Berechnete Anzeigen im Heldenbogen.
 * Elemente mit data-derived="name:arg" bekommen den Text, Felder mit
 * data-auto="name:arg" den berechneten Wert als Platzhalter („leer = automatisch“).
 */
import {
  ROMAN_LEVELS,
  apRemaining,
  experienceLevel,
  painLevelFromLe,
  weightByLocation,
  moneyToKreuzer,
  kreuzerToMoney,
  formatMoney,
} from '../../rules.js';
import {
  describeCheck,
  dodgeOf,
  initiativeBaseOf,
  conditionState,
  computedTechniqueValues,
  techniqueValues,
  weaponValues,
  spellTypeInfo,
} from '../../sheet.js';
import { RESOURCE_NAMES } from '../../data/talents.js';
import { formatModifier } from '../../format.js';
import { formatDecimal } from '../../util.js';

const byId = (list, id) => list.find((entry) => entry.id === id);
const valueText = (value) => (value === null || value === undefined ? '–' : String(value));

/** Gewicht je Inventar-Gruppe des Helden. */
const groupWeights = (hero) =>
  weightByLocation(
    hero.inventory,
    hero.inventoryGroups.map(({ id }) => id),
  );

const DERIVED = {
  'ap-remaining': (hero) => String(apRemaining(hero.general.apTotal, hero.general.apSpent)),
  'ap-level': (hero) => `Laut AP: ${experienceLevel(hero.general.apTotal)}`,
  dodge: (hero) => String(dodgeOf(hero)),
  'ini-base': (hero) => String(initiativeBaseOf(hero)),

  'condition-summary': (hero) => {
    const { penalty } = conditionState(hero);
    return penalty ? `Abzug auf Proben: ${formatModifier(penalty)} (höchstens −5)` : 'Keine Abzüge auf Proben';
  },
  'pain-from-le': (hero) => `aus LE: ${ROMAN_LEVELS[painLevelFromLe(hero.base.le.current, hero.base.le.max)]}`,

  'talent-sub': (hero, id) => {
    const talent = byId(hero.talents, id);
    return describeCheck(hero, talent.check) + (talent.spec ? ` · Spez.: ${talent.spec}` : '');
  },

  'technique-value': (hero, arg) => {
    const [id, key] = arg.split('|');
    return valueText(techniqueValues(hero, byId(hero.combatTechniques, id))[key]);
  },
  'technique-auto': (hero, arg) => {
    const [id, key] = arg.split('|');
    return valueText(computedTechniqueValues(hero, byId(hero.combatTechniques, id))[key]);
  },

  'weapon-name': (hero, id) => byId(hero.weapons, id).name || 'Neue Waffe',
  'weapon-value': (hero, arg) => {
    const [id, key] = arg.split('|');
    return valueText(weaponValues(hero, byId(hero.weapons, id))[key]);
  },
  'weapon-sub': (hero, id) => {
    const weapon = byId(hero.weapons, id);
    const range = weapon.range ? ` · RW ${weapon.range}` : '';
    return `${weaponValues(hero, weapon).techniqueName}${range}`;
  },
  'weapon-tp': (hero, id) => byId(hero.weapons, id).tp || '–',

  'spell-name': (hero, id) => byId(hero.spells, id).name || 'Neuer Eintrag',
  'spell-sub': (hero, id) => {
    const spell = byId(hero.spells, id);
    const type = spellTypeInfo(spell.type);
    const cost = spell.cost ? ` · ${spell.cost}` : '';
    return `${type.name} · ${describeCheck(hero, spell.check)}${cost}`;
  },

  energy: (hero, resource) => {
    const pool = hero.base[resource];
    return `${RESOURCE_NAMES[resource]} ${pool.current}/${pool.max}`;
  },

  'weight-total': (hero) => `${formatDecimal(groupWeights(hero).total)} Stein`,
  'inventory-group': (hero, group) => {
    const count = hero.inventory.filter((item) => item.location === group).length;
    const weight = formatDecimal(groupWeights(hero).byLocation[group] ?? 0);
    return `${count} ${count === 1 ? 'Gegenstand' : 'Gegenstände'} · ${weight} Stein`;
  },
  'money-total': (hero) => {
    const kreuzer = moneyToKreuzer(hero.money);
    return `Gesamt: ${formatMoney(kreuzerToMoney(kreuzer))} (= ${kreuzer.toLocaleString('de-DE')} K)`;
  },
};

function compute(spec, hero) {
  const separator = spec.indexOf(':');
  const name = separator === -1 ? spec : spec.slice(0, separator);
  const arg = separator === -1 ? '' : spec.slice(separator + 1);
  const handler = DERIVED[name];
  if (!handler) throw new Error(`Unbekannte Anzeige „${name}“`);
  return handler(hero, arg);
}

/** Aktualisiert alle berechneten Anzeigen und Platzhalter unterhalb von root. */
export function refreshDerived(root, hero) {
  for (const element of root.querySelectorAll('[data-derived]')) {
    element.textContent = compute(element.dataset.derived, hero);
  }
  for (const element of root.querySelectorAll('[data-auto]')) {
    element.placeholder = compute(element.dataset.auto, hero);
  }
}
