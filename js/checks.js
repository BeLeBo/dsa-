/**
 * checks.js – Führt Proben aus: Heldenwerte + Würfel (dice.js) + Regeln (rules.js).
 * Jede Funktion liefert einen Protokolleintrag (JSON-fähig), der angezeigt,
 * gespeichert und später mit der Gruppe geteilt werden kann.
 *
 * Alle Würfe lassen sich mit einer eigenen Würfelfunktion `roll(sides)` testen.
 */
import {
  SPECIALIZATION_BONUS,
  skillCheck,
  d20Check,
  needsConfirmation,
  canRerollWithFate,
  replaceDice,
  initiativeTotal,
  toInt,
} from './rules.js';
import { rollDie, rollDice, rollExpression } from './dice.js';
import { heroName, checkValues, conditionState, initiativeBaseOf } from './sheet.js';
import { newId } from './util.js';

/** Protokoll-Typen */
export const ROLL_TYPES = Object.freeze({
  SKILL: 'fertigkeit',
  ATTRIBUTE: 'eigenschaft',
  COMBAT: 'kampf',
  DAMAGE: 'schaden',
  INITIATIVE: 'initiative',
  FREE: 'frei',
});

function createRecord(actor, type, label, details = {}) {
  return { id: newId(), time: new Date().toISOString(), actor, type, label, ...details };
}

/**
 * Gesamtmodifikator einer Probe: eigener Wert plus Zustandsabzug.
 * @returns {{ manual: number, conditions: number, total: number }}
 */
export function composeModifier(hero, manual = 0, includeConditions = true) {
  const conditions = includeConditions ? conditionState(hero).penalty : 0;
  const own = toInt(manual);
  return { manual: own, conditions, total: own + conditions };
}

/**
 * Fertigkeitsprobe für ein Talent oder einen Zauber/eine Liturgie.
 * @param {object} hero
 * @param {object} entry  Talent- oder Zaubereintrag mit { check, fw, spec? }
 * @param {object} options { label, modifier, includeConditions, useSpecialization, roll }
 */
export function rollSkill(hero, entry, options = {}) {
  const { label, modifier = 0, includeConditions = true, useSpecialization = false, roll = rollDie } = options;
  const specialization = useSpecialization && entry.spec ? entry.spec : null;
  const mod = composeModifier(hero, modifier, includeConditions);
  const result = skillCheck({
    attributes: checkValues(hero, entry.check),
    fw: toInt(entry.fw) + (specialization ? SPECIALIZATION_BONUS : 0),
    modifier: mod.total,
    rolls: rollDice(3, 20, roll),
  });
  return createRecord(heroName(hero), ROLL_TYPES.SKILL, label, {
    check: [...entry.check],
    specialization,
    modifier: mod,
    result,
  });
}

function rollD20WithConfirmation(target, modifier, roll) {
  const first = roll(20);
  const confirmRoll = needsConfirmation(first) ? roll(20) : null;
  return d20Check({ target, modifier, roll: first, confirmRoll });
}

/**
 * Probe auf 1W20: Eigenschaft (type = ROLL_TYPES.ATTRIBUTE) oder Kampf (ROLL_TYPES.COMBAT).
 * @param {object} options { type, label, target, modifier, includeConditions, weaponId, roll }
 */
export function rollD20(hero, options) {
  const { type, label, target, modifier = 0, includeConditions = true, weaponId = null, roll = rollDie } = options;
  const mod = composeModifier(hero, modifier, includeConditions);
  const result = rollD20WithConfirmation(target, mod.total, roll);
  return createRecord(heroName(hero), type, label, { modifier: mod, weaponId, result });
}

/** Ergebnis eines Würfelausdrucks als Protokoll-Ergebnis (optional verdoppelt). */
function expressionResult(expression, roll, multiplier = 1) {
  const dice = rollExpression(expression, roll);
  return { kind: 'ausdruck', ...dice, subtotal: dice.total, multiplier, total: dice.total * multiplier };
}

/** Schadenswurf einer Waffe; bei kritischem Treffer mit doppelt = true. */
export function rollDamage(hero, weapon, { double = false, roll = rollDie } = {}) {
  const label = `Schaden ${weapon.name || 'Waffe'}`;
  return createRecord(heroName(hero), ROLL_TYPES.DAMAGE, label, {
    result: expressionResult(weapon.tp, roll, double ? 2 : 1),
  });
}

/** Freier Würfelausdruck wie „2W6+3“. */
export function rollFree(actor, expression, { roll = rollDie } = {}) {
  const result = expressionResult(expression, roll);
  return createRecord(actor, ROLL_TYPES.FREE, result.expression, { result });
}

/** Initiative: INI-Basis + 1W6 (+ Modifikator). */
export function rollInitiative(hero, { modifier = 0, roll = rollDie } = {}) {
  const base = initiativeBaseOf(hero);
  const die = roll(6);
  const mod = toInt(modifier);
  return createRecord(heroName(hero), ROLL_TYPES.INITIATIVE, 'Initiative', {
    result: { kind: 'initiative', base, roll: die, modifier: mod, total: initiativeTotal(base, die, mod) },
  });
}

// ---------------------------------------------------------------------------
// Schicksalspunkte
// ---------------------------------------------------------------------------

const CHECK_TYPES = new Set([ROLL_TYPES.SKILL, ROLL_TYPES.ATTRIBUTE, ROLL_TYPES.COMBAT]);

/** Proben (im Gegensatz zu Schaden, Initiative, freien Würfen) sind mit Schicksalspunkt wiederholbar. */
export function isCheckRecord(record) {
  return CHECK_TYPES.has(record.type);
}

/** Darf dieser Eintrag mit einem Schicksalspunkt neu gewürfelt werden? (Grund, falls nicht) */
export function fateRerollBlocker(record) {
  if (!isCheckRecord(record)) return 'Nur Proben können mit einem Schicksalspunkt wiederholt werden.';
  if (record.fate) return 'Das Ergebnis eines Neuwurfs ist bindend.';
  if (!canRerollWithFate(record.result)) return 'Nach einem Patzer ist kein Neuwurf erlaubt.';
  return null;
}

/**
 * Würfelt die gewählten Würfel neu (Fertigkeitsprobe: Indizes 0–2; W20-Probe: ganze Probe).
 * Das neue Ergebnis ist bindend. Der Schicksalspunkt selbst wird in sheet.js abgezogen.
 */
export function rerollWithFate(record, indices = [0], { roll = rollDie } = {}) {
  const blocker = fateRerollBlocker(record);
  if (blocker) throw new Error(blocker);

  const previous = record.result;
  let result;
  if (record.type === ROLL_TYPES.SKILL) {
    if (indices.length === 0) throw new Error('Bitte mindestens einen Würfel zum Neuwürfeln auswählen.');
    const replacements = Object.fromEntries(indices.map((index) => [index, roll(20)]));
    result = skillCheck({ ...previous, rolls: replaceDice(previous.rolls, replacements) });
  } else {
    result = rollD20WithConfirmation(previous.target, previous.modifier, roll);
  }
  return {
    ...record,
    id: newId(),
    time: new Date().toISOString(),
    fate: { rerollOf: record.id, indices: record.type === ROLL_TYPES.SKILL ? [...indices] : [0], previous },
    result,
  };
}
