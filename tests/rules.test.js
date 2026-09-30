/**
 * rules.test.js – Automatische Prüfung von rules.js und dice.js.
 */
import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import {
  SPECIAL,
  skillCheck,
  qualityLevel,
  d20Check,
  needsConfirmation,
  canRerollWithFate,
  replaceDice,
  initiativeTotal,
  sortInitiative,
  attributeBonus,
  attackValue,
  parryValue,
  rangedValue,
  dodgeValue,
  initiativeBase,
  painLevelFromLe,
  effectiveConditionLevels,
  conditionPenalty,
  parseCost,
  costToPay,
  apRemaining,
  experienceLevel,
  moneyToKreuzer,
  kreuzerToMoney,
  formatMoney,
  weightByLocation,
  toInt,
  toNumber,
} from '../js/rules.js';
import { fixedRolls } from './fixtures.js';
import {
  DiceError,
  randomInt,
  rollDie,
  rollDice,
  parseDiceExpression,
  evaluateDiceExpression,
  rollExpression,
} from '../js/dice.js';

// ---------------------------------------------------------------------------
// Pflicht-Testfälle aus der Aufgabenstellung
// ---------------------------------------------------------------------------

const PFLICHT = 'Pflicht-Testfälle (Aufgabenstellung)';
const BASE = { attributes: [12, 13, 11] };

test(PFLICHT, '1) 12/13/11, FW 6, Mod 0, Würfe 14/9/12 → 3 FP übrig, gelungen, QS 1', () => {
  const r = skillCheck({ ...BASE, fw: 6, modifier: 0, rolls: [14, 9, 12] });
  assertEqual(r.remainingFp, 3, 'Rest-FP');
  assertEqual(r.success, true, 'gelungen');
  assertEqual(r.qs, 1, 'QS');
  assertEqual(r.special, null, 'kein kritischer Ausgang');
});

test(PFLICHT, '2) wie 1, aber Erschwernis 2 → misslungen', () => {
  const r = skillCheck({ ...BASE, fw: 6, modifier: -2, rolls: [14, 9, 12] });
  assertEqual(r.targets, [10, 11, 9], 'modifizierte Eigenschaften');
  assertEqual(r.remainingFp, -1, 'Rest-FP');
  assertEqual(r.success, false, 'misslungen');
  assertEqual(r.qs, 0, 'QS');
});

test(PFLICHT, '3) 12/13/11, FW 0, Würfe 1/1/18 → kritischer Erfolg', () => {
  const r = skillCheck({ ...BASE, fw: 0, rolls: [1, 1, 18] });
  assertEqual(r.special, SPECIAL.CRITICAL, 'kritischer Erfolg');
  assertEqual(r.success, true, 'gelingt trotz fehlender FP');
  assertEqual(r.qs, 1, 'mindestens QS 1');
});

test(PFLICHT, '4) 12/13/11, FW 10, Würfe 20/20/5 → Patzer', () => {
  const r = skillCheck({ ...BASE, fw: 10, rolls: [20, 20, 5] });
  assertEqual(r.special, SPECIAL.BOTCH, 'Patzer');
  assertEqual(r.success, false, 'misslingt immer');
  assertEqual(r.qs, 0, 'QS');
});

test(PFLICHT, '5) 14/14/14, FW 10, Würfe 3/4/5 → 10 FP, QS 4', () => {
  const r = skillCheck({ attributes: [14, 14, 14], fw: 10, rolls: [3, 4, 5] });
  assertEqual(r.remainingFp, 10, 'Rest-FP');
  assertEqual(r.success, true, 'gelungen');
  assertEqual(r.qs, 4, 'QS');
});

// ---------------------------------------------------------------------------
// Fertigkeitsprobe – weitere Fälle
// ---------------------------------------------------------------------------

const SKILL = 'Fertigkeitsprobe (3W20)';

test(SKILL, 'QS-Tabelle an allen Grenzen', () => {
  const expected = { 0: 1, 3: 1, 4: 2, 6: 2, 7: 3, 9: 3, 10: 4, 12: 4, 13: 5, 15: 5, 16: 6, 18: 6, 25: 6 };
  for (const [fp, qs] of Object.entries(expected)) assertEqual(qualityLevel(Number(fp)), qs, `${fp} FP`);
});

test(SKILL, 'Drei 1er → spektakulärer Erfolg', () => {
  const r = skillCheck({ ...BASE, fw: 4, rolls: [1, 1, 1] });
  assertEqual(r.special, SPECIAL.SPECTACULAR);
  assertEqual(r.success, true);
  assertEqual(r.qs, 2, '4 FP → QS 2');
});

test(SKILL, 'Drei 20er → spektakulärer Patzer', () => {
  const r = skillCheck({ ...BASE, fw: 18, rolls: [20, 20, 20] });
  assertEqual(r.special, SPECIAL.SPECTACULAR_BOTCH);
  assertEqual(r.success, false);
});

test(SKILL, 'Eine einzelne 20 ist kein Patzer', () => {
  const r = skillCheck({ attributes: [15, 15, 15], fw: 8, rolls: [20, 3, 4] });
  assertEqual(r.special, null);
  assertEqual(r.remainingFp, 3);
  assertEqual(r.success, true);
});

test(SKILL, 'Erleichterung wird auf alle drei Eigenschaften angerechnet', () => {
  const r = skillCheck({ ...BASE, fw: 6, modifier: 3, rolls: [14, 9, 12] });
  assertEqual(r.targets, [15, 16, 14]);
  assertEqual(r.excess, [0, 0, 0]);
  assertEqual(r.remainingFp, 6);
  assertEqual(r.qs, 2);
});

test(SKILL, 'Genau 0 Rest-FP ist gelungen (QS 1)', () => {
  const r = skillCheck({ ...BASE, fw: 3, rolls: [14, 9, 12] });
  assertEqual(r.remainingFp, 0);
  assertEqual(r.success, true);
  assertEqual(r.qs, 1);
});

test(SKILL, 'Werte aus Formularfeldern (Strings) werden akzeptiert', () => {
  const r = skillCheck({ attributes: ['12', '13', '11'], fw: '6', modifier: '0', rolls: [14, 9, 12] });
  assertEqual(r.remainingFp, 3);
});

test(SKILL, 'Ungültige Würfel oder falsche Anzahl werfen verständliche Fehler', () => {
  assertThrows(() => skillCheck({ ...BASE, fw: 5, rolls: [0, 5, 5] }), RangeError, 'Wurf 0');
  assertThrows(() => skillCheck({ ...BASE, fw: 5, rolls: [21, 5, 5] }), RangeError, 'Wurf 21');
  assertThrows(() => skillCheck({ ...BASE, fw: 5, rolls: [5, 5] }), RangeError, 'zwei Würfe');
  assertThrows(() => skillCheck({ attributes: [12, 13], fw: 5, rolls: [5, 5, 5] }), RangeError, 'zwei Eigenschaften');
});

// ---------------------------------------------------------------------------
// W20-Proben (Eigenschaft & Kampf)
// ---------------------------------------------------------------------------

const D20 = 'W20-Probe (Eigenschaft, AT, PA, AW, FK)';

test(D20, 'Wurf ≤ Wert ± Mod gelingt, darüber misslingt', () => {
  assertEqual(d20Check({ target: 12, roll: 12 }).success, true, '12 gegen 12');
  assertEqual(d20Check({ target: 12, roll: 13 }).success, false, '13 gegen 12');
  assertEqual(d20Check({ target: 12, modifier: -2, roll: 11 }).success, false, '11 gegen 12−2');
  assertEqual(d20Check({ target: 12, modifier: 2, roll: 14 }).success, true, '14 gegen 12+2');
});

test(D20, 'Bestätigungswurf nur bei 1 und 20', () => {
  assertEqual(needsConfirmation(1), true);
  assertEqual(needsConfirmation(20), true);
  assertEqual(needsConfirmation(2), false);
  assertEqual(needsConfirmation(19), false);
  assertEqual(d20Check({ target: 10, roll: 5, confirmRoll: 3 }).confirmRoll, null, 'wird ignoriert');
});

test(D20, '1 + gelungene Bestätigung → kritischer Erfolg', () => {
  const r = d20Check({ target: 12, roll: 1, confirmRoll: 8 });
  assertEqual(r.success, true);
  assertEqual(r.special, SPECIAL.CRITICAL);
});

test(D20, '1 + misslungene Bestätigung → normaler Erfolg', () => {
  const r = d20Check({ target: 12, roll: 1, confirmRoll: 15 });
  assertEqual(r.success, true);
  assertEqual(r.special, null);
});

test(D20, '20 + misslungene Bestätigung → Patzer', () => {
  const r = d20Check({ target: 12, roll: 20, confirmRoll: 17 });
  assertEqual(r.success, false);
  assertEqual(r.special, SPECIAL.BOTCH);
});

test(D20, '20 + gelungene Bestätigung → normaler Misserfolg (auch bei hohem Wert)', () => {
  const r = d20Check({ target: 22, roll: 20, confirmRoll: 4 });
  assertEqual(r.success, false);
  assertEqual(r.special, null);
});

test(D20, 'Fehlender Bestätigungswurf wirft einen Fehler', () => {
  assertThrows(() => d20Check({ target: 12, roll: 20 }), RangeError);
});

// ---------------------------------------------------------------------------
// Schicksalspunkte
// ---------------------------------------------------------------------------

const FATE = 'Schicksalspunkte';

test(FATE, 'Einzelne Würfel ersetzen', () => {
  assertEqual(replaceDice([14, 9, 12], { 0: 3 }), [3, 9, 12]);
  assertEqual(replaceDice([14, 9, 12], { 0: 3, 2: 7 }), [3, 9, 7]);
  assertEqual(replaceDice([14, 9, 12], {}), [14, 9, 12]);
});

test(FATE, 'Neuwurf ist nach Patzer nicht erlaubt, sonst schon', () => {
  assertEqual(canRerollWithFate(skillCheck({ ...BASE, fw: 10, rolls: [20, 20, 5] })), false, 'Patzer 3W20');
  assertEqual(canRerollWithFate(d20Check({ target: 12, roll: 20, confirmRoll: 18 })), false, 'Patzer W20');
  assertEqual(canRerollWithFate(skillCheck({ ...BASE, fw: 6, modifier: -2, rolls: [14, 9, 12] })), true);
});

// ---------------------------------------------------------------------------
// Kampfwerte & Initiative
// ---------------------------------------------------------------------------

const COMBAT = 'Kampfwerte & Initiative';

test(COMBAT, 'Leiteigenschafts-Bonus: +1 je 3 Punkte über 8', () => {
  const expected = { 8: 0, 10: 0, 11: 1, 13: 1, 14: 2, 16: 2, 17: 3, 20: 4 };
  for (const [value, bonus] of Object.entries(expected))
    assertEqual(attributeBonus(Number(value)), bonus, `Wert ${value}`);
});

test(COMBAT, 'AT, PA, FK, Ausweichen, INI-Basis', () => {
  assertEqual(attackValue(12, 14), 14, 'AT = 12 + 2');
  assertEqual(parryValue(12, [13, 15]), 8, 'PA = 6 + 2 (bessere Leiteigenschaft 15)');
  assertEqual(parryValue(11, 12), 7, 'PA = 6 (aufgerundet) + 1');
  assertEqual(rangedValue(10, 16), 12, 'FK = 10 + 2');
  assertEqual(dodgeValue(13), 7, 'AW = 13/2 kaufmännisch gerundet');
  assertEqual(initiativeBase(13, 14), 14, 'INI = 27/2 → 14');
});

test(COMBAT, 'Initiative = Basis + 1W6 + Mod', () => {
  assertEqual(initiativeTotal(12, 4), 16);
  assertEqual(initiativeTotal(12, 4, -2), 14);
  assertThrows(() => initiativeTotal(12, 7), RangeError, 'W6 = 7');
});

test(COMBAT, 'Kampfreihenfolge: Summe, dann Basis, dann Stechwurf', () => {
  const order = sortInitiative([
    { name: 'Alrik', base: 12, total: 15 },
    { name: 'Bosper', base: 14, total: 15 },
    { name: 'Ork', base: 10, total: 18 },
    { name: 'Rondrian', base: 12, total: 15, tiebreak: 5 },
    { name: 'Gerion', base: 12, total: 15, tiebreak: 2 },
  ]).map((entry) => entry.name);
  assertEqual(order, ['Ork', 'Bosper', 'Rondrian', 'Gerion', 'Alrik']);
});

// ---------------------------------------------------------------------------
// Zustände
// ---------------------------------------------------------------------------

const COND = 'Zustände & Schmerz';

test(COND, 'Schmerz aus LE (LE max 32)', () => {
  const expected = { 32: 0, 25: 0, 24: 1, 17: 1, 16: 2, 9: 2, 8: 3, 6: 3, 5: 4, 0: 4, [-3]: 4 };
  for (const [le, pain] of Object.entries(expected)) assertEqual(painLevelFromLe(Number(le), 32), pain, `LE ${le}`);
});

test(COND, 'Kein Schmerz ohne gültige Max-LE', () => {
  assertEqual(painLevelFromLe(3, 0), 0);
});

test(COND, 'Abzug −1 je Stufe, einzelne Zustände abschaltbar', () => {
  assertEqual(conditionPenalty({}), 0, 'keine Zustände');
  assertEqual(conditionPenalty({ schmerz: 2, furcht: 1 }), -3);
  assertEqual(conditionPenalty({ schmerz: 2, furcht: 1 }, { furcht: true }), -2);
});

test(COND, 'Gesamtabzug höchstens −5, Stufen höchstens IV', () => {
  assertEqual(conditionPenalty({ schmerz: 4, betaeubung: 3 }), -5);
  assertEqual(conditionPenalty({ schmerz: 9 }), -4);
});

test(COND, 'Automatischer Schmerz addiert sich zum eingetragenen (max IV)', () => {
  assertEqual(effectiveConditionLevels({ schmerz: 1 }, { autoPain: true, le: 16, leMax: 32 }).schmerz, 3);
  assertEqual(effectiveConditionLevels({ schmerz: 2 }, { autoPain: true, le: 5, leMax: 32 }).schmerz, 4);
  assertEqual(effectiveConditionLevels({ schmerz: 2 }, { autoPain: false, le: 5, leMax: 32 }).schmerz, 2);
  assertEqual(effectiveConditionLevels({}).furcht, 0);
});

// ---------------------------------------------------------------------------
// Zauber, AP, Geld, Gewicht
// ---------------------------------------------------------------------------

const MISC = 'Zauberkosten, AP, Geld, Gewicht';

test(MISC, 'Kosten aus Text lesen', () => {
  assertEqual(parseCost('8 AsP'), 8);
  assertEqual(parseCost('16 KaP + 2 pro Minute'), 16);
  assertEqual(parseCost('nach Ritual'), null);
  assertEqual(parseCost(undefined), null);
});

test(MISC, 'Volle Kosten bei Erfolg, halbe (gerundet, min. 1) bei Misserfolg', () => {
  assertEqual(costToPay(8, true), 8);
  assertEqual(costToPay(8, false), 4);
  assertEqual(costToPay(7, false), 4);
  assertEqual(costToPay(1, false), 1);
  assertEqual(costToPay(0, false), 0);
});

test(MISC, 'AP übrig und Erfahrungsgrad', () => {
  assertEqual(apRemaining(1100, 1040), 60);
  assertEqual(experienceLevel(500), 'Unerfahren');
  assertEqual(experienceLevel(1100), 'Erfahren');
  assertEqual(experienceLevel(1399), 'Kompetent');
  assertEqual(experienceLevel(2500), 'Legendär');
});

test(MISC, 'Geld umrechnen: 1 D = 10 S = 100 H = 1000 K', () => {
  assertEqual(moneyToKreuzer({ dukaten: 1, silbertaler: 2, heller: 3, kreuzer: 4 }), 1234);
  assertEqual(kreuzerToMoney(1234), { dukaten: 1, silbertaler: 2, heller: 3, kreuzer: 4 });
  assertEqual(kreuzerToMoney(moneyToKreuzer({ silbertaler: 25, kreuzer: 12 })), {
    dukaten: 2,
    silbertaler: 5,
    heller: 1,
    kreuzer: 2,
  });
  assertEqual(kreuzerToMoney(-50), { dukaten: 0, silbertaler: 0, heller: 0, kreuzer: 0 });
  assertEqual(formatMoney({ dukaten: 3, silbertaler: 2, kreuzer: 5 }), '3 D 2 S 5 K');
  assertEqual(formatMoney({}), '0 K');
});

test(MISC, 'Gewicht je Ort und gesamt (inkl. Komma-Eingabe)', () => {
  const { byLocation, total } = weightByLocation([
    { weight: 2, count: 1, location: 'koerper' },
    { weight: '0,1', count: 3, location: 'rucksack' },
    { weight: 1.5, count: 2, location: 'rucksack' },
    { weight: 10, count: 1, location: 'packtier' },
    { weight: 1, location: 'unbekannt' },
  ]);
  assertEqual(byLocation, { koerper: 3, rucksack: 3.3, wagen: 0, packtier: 10 });
  assertEqual(total, 16.3);
});

test(MISC, 'Zahlen aus Eingaben', () => {
  assertEqual(toInt('12'), 12);
  assertEqual(toInt('abc', 7), 7);
  assertEqual(toInt(3.9), 3);
  assertEqual(toNumber('1,5'), 1.5);
});

// ---------------------------------------------------------------------------
// Würfel (dice.js)
// ---------------------------------------------------------------------------

const DICE = 'Würfel & Würfelausdrücke';

test(DICE, 'Würfelausdrücke zerlegen', () => {
  assertEqual(parseDiceExpression('2W6+3'), { dice: [{ sign: 1, count: 2, sides: 6 }], constant: 3, text: '2W6+3' });
  assertEqual(parseDiceExpression('1W20').text, '1W20');
  assertEqual(parseDiceExpression('3W20').dice, [{ sign: 1, count: 3, sides: 20 }]);
  assertEqual(parseDiceExpression(' w6 ').text, '1W6', 'Anzahl weggelassen, Kleinschreibung');
  assertEqual(parseDiceExpression('2d6 - 1').text, '2W6-1', 'D statt W');
  assertEqual(parseDiceExpression('1W6+1W4-2+1').text, '1W6+1W4-1', 'mehrere Gruppen, Zahlen zusammengefasst');
});

test(DICE, 'Ungültige Ausdrücke liefern DiceError mit deutscher Nachricht', () => {
  for (const input of ['', 'abc', '2W', '2W6+', '2W6++3', 'W1', '0W6', '101W6', '5', '2W6*2']) {
    const error = assertThrows(() => parseDiceExpression(input), DiceError, `„${input}“`);
    assertTrue(error.message.length > 10, `Nachricht für „${input}“`);
  }
});

test(DICE, 'Ausdruck mit festen Würfeln auswerten', () => {
  const result = evaluateDiceExpression(parseDiceExpression('2W6+3'), fixedRolls([4, 5]));
  assertEqual(result.groups[0].rolls, [4, 5]);
  assertEqual(result.modifier, 3);
  assertEqual(result.total, 12);

  const negative = rollExpression('1W6-1W4', fixedRolls([2, 4]));
  assertEqual(
    negative.groups.map((group) => group.subtotal),
    [2, -4],
  );
  assertEqual(negative.total, -2);
});

test(DICE, 'rollDice nutzt die übergebene Würfelfunktion', () => {
  assertEqual(rollDice(3, 20, fixedRolls([1, 2, 3])), [1, 2, 3]);
});

test(DICE, 'Zufallswürfel bleiben im Bereich (10 000 × W20)', () => {
  for (let i = 0; i < 10000; i += 1) {
    const value = rollDie(20);
    assertTrue(Number.isInteger(value) && value >= 1 && value <= 20, `Wert ${value} außerhalb 1–20`);
  }
});

test(DICE, 'W6 ist gleichverteilt (60 000 Würfe, jede Seite 9 000–11 000×)', () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 60000; i += 1) counts[rollDie(6)] += 1;
  for (let side = 1; side <= 6; side += 1) {
    assertTrue(counts[side] > 9000 && counts[side] < 11000, `Seite ${side}: ${counts[side]}×`);
  }
});

test(DICE, 'randomInt lehnt ungültige Grenzen ab', () => {
  assertThrows(() => randomInt(0), RangeError);
  assertThrows(() => randomInt(1.5), RangeError);
  assertEqual(randomInt(1), 1);
});

test(DICE, 'Zufall stammt aus crypto.getRandomValues', () => {
  const original = crypto.getRandomValues.bind(crypto);
  let calls = 0;
  crypto.getRandomValues = (array) => {
    calls += 1;
    return original(array);
  };
  try {
    rollDie(20);
  } finally {
    delete crypto.getRandomValues; // wieder die Methode des Prototyps verwenden
  }
  assertTrue(calls >= 1, 'crypto.getRandomValues wurde nicht aufgerufen');
});
