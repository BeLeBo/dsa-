/**
 * sheet.test.js – Tests für Heldenmodell (sheet.js), Proben (checks.js) und Texte (format.js).
 */
import { test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { fixedRolls } from './fixtures.js';
import { ATTRIBUTES, SPECIAL } from '../js/rules.js';
import { TALENTS, TALENT_GROUPS, COMBAT_TECHNIQUES } from '../js/data/talents.js';
import {
  createHero,
  createSpell,
  createWeapon,
  normalizeHero,
  exportHero,
  importHero,
  HeroImportError,
  dodgeOf,
  initiativeBaseOf,
  techniqueValues,
  weaponValues,
  conditionState,
  describeConditions,
  payEnergy,
  refundEnergy,
  spendFatePoint,
  structureSignature,
  createInventoryGroup,
  MAX_INVENTORY_GROUPS,
} from '../js/sheet.js';
import {
  ROLL_TYPES,
  composeModifier,
  rollSkill,
  rollD20,
  rollDamage,
  rollFree,
  rollInitiative,
  fateRerollBlocker,
  rerollWithFate,
} from '../js/checks.js';
import { describeOutcome, describeModifier, formatModifier } from '../js/format.js';

/** Held mit festen Eigenschaften für die Tests. */
function testHero() {
  const hero = createHero();
  Object.assign(hero.attributes, { MU: 12, KL: 13, IN: 11, CH: 10, FF: 14, GE: 13, KO: 12, KK: 14 });
  hero.general.name = 'Alrik';
  return hero;
}

function talent(hero, id) {
  return hero.talents.find((entry) => entry.id === id);
}

// ---------------------------------------------------------------------------
// Stammdaten
// ---------------------------------------------------------------------------

const DATA = 'Stammdaten: Talente & Kampftechniken';

test(DATA, 'Alle 59 DSA5-Talente in 5 Gruppen', () => {
  assertEqual(TALENTS.length, 59);
  assertEqual(TALENT_GROUPS.length, 5);
  const counts = Object.fromEntries(TALENT_GROUPS.map(({ id }) => [id, TALENTS.filter((t) => t.group === id).length]));
  assertEqual(counts, { koerper: 14, gesellschaft: 9, natur: 7, wissen: 12, handwerk: 17 });
});

test(DATA, 'Jedes Talent hat drei gültige Probeneigenschaften und eine eindeutige ID', () => {
  assertEqual(new Set(TALENTS.map((t) => t.id)).size, TALENTS.length, 'eindeutige IDs');
  for (const entry of TALENTS) {
    assertEqual(entry.check.length, 3, entry.name);
    assertTrue(
      entry.check.every((code) => ATTRIBUTES.includes(code)),
      `${entry.name}: ${entry.check}`,
    );
  }
});

test(DATA, 'Beispiele für Probeneigenschaften', () => {
  const byName = (name) => TALENTS.find((t) => t.name === name).check.join('/');
  assertEqual(byName('Klettern'), 'MU/GE/KK');
  assertEqual(byName('Sinnesschärfe'), 'KL/IN/IN');
  assertEqual(byName('Heilkunde Wunden'), 'KL/FF/FF');
  assertEqual(byName('Überreden'), 'MU/IN/CH');
});

test(DATA, 'Kampftechniken mit Leiteigenschaft', () => {
  assertTrue(COMBAT_TECHNIQUES.length >= 18, 'mindestens 18 Kampftechniken');
  assertEqual(COMBAT_TECHNIQUES.find((t) => t.id === 'schwerter').leading, ['GE', 'KK']);
  assertEqual(COMBAT_TECHNIQUES.find((t) => t.id === 'boegen').ranged, true);
});

// ---------------------------------------------------------------------------
// Heldenmodell
// ---------------------------------------------------------------------------

const MODEL = 'Heldenmodell (sheet.js)';

test(MODEL, 'Neuer Held ist vollständig und bleibt beim Normalisieren gleich', () => {
  const hero = createHero();
  assertEqual(hero.talents.length, 59);
  assertEqual(
    hero.combatTechniques.every((t) => t.ktw === 6),
    true,
    'KtW 6',
  );
  assertEqual(normalizeHero(hero), hero);
});

test(MODEL, 'Kaputte Daten werden repariert statt abzustürzen', () => {
  const hero = normalizeHero({
    general: { name: 42, apTotal: 'viel', experience: 'Gott' },
    attributes: { MU: '14', KL: null, XX: 99 },
    base: { le: { current: '20', max: 30 }, aw: '', ini: '9' },
    talents: [{ id: 'klettern', fw: '7', check: ['MU', 'XX', 'KK'] }, { id: 'unbekannt', fw: 3 }, 'Müll'],
    weapons: [{ name: 'Säbel', technique: 'laserschwert' }, null],
    conditions: { schmerz: 9, furcht: -2 },
    inventory: [{ name: 'Seil', weight: '1,5', location: 'mond' }],
  });
  assertEqual(hero.general.name, '42');
  assertEqual(hero.general.apTotal, 1100, 'Standard-AP');
  assertEqual(hero.general.experience, 'Erfahren');
  assertEqual(hero.attributes.MU, 14);
  assertEqual('XX' in hero.attributes, false, 'unbekannte Eigenschaft entfernt');
  assertEqual(hero.base.le, { current: 20, max: 30 });
  assertEqual(hero.base.aw, null, 'leer = automatisch');
  assertEqual(hero.base.ini, 9);
  assertEqual(talent(hero, 'klettern').fw, 7);
  assertEqual(talent(hero, 'klettern').check, ['MU', 'GE', 'KK'], 'ungültige Eigenschaft ersetzt');
  assertEqual(hero.talents.length, 59, 'unbekannte Talente verworfen');
  assertEqual(hero.weapons.length, 1);
  assertEqual(hero.weapons[0].technique, 'schwerter');
  assertTrue(typeof hero.weapons[0].id === 'string' && hero.weapons[0].id.length > 0, 'Waffe bekommt ID');
  assertEqual(hero.conditions.schmerz, 4);
  assertEqual(hero.conditions.furcht, 0);
  assertEqual(hero.inventory[0].weight, 1.5);
  assertEqual(hero.inventory[0].location, 'koerper');
});

test(MODEL, 'Doppelte IDs in Listen werden ersetzt', () => {
  const hero = normalizeHero({
    spells: [
      { id: 'a', name: 'X' },
      { id: 'a', name: 'Y' },
    ],
  });
  assertEqual(hero.spells[0].id, 'a');
  assertTrue(hero.spells[1].id !== 'a', 'zweite ID neu vergeben');
});

test(MODEL, 'Export und Import ergeben denselben Helden', () => {
  const hero = testHero();
  hero.weapons.push({ ...createWeapon(), name: 'Langschwert' });
  hero.spells.push({ ...createSpell(), name: 'Ignifaxius', cost: '8 AsP' });
  hero.inventory.push({ id: 'i1', name: 'Seil', count: 1, weight: 1.5, location: 'rucksack', note: '' });
  assertEqual(importHero(exportHero(hero)), hero);
});

test(MODEL, 'Import akzeptiert auch rohes Helden-JSON', () => {
  const hero = testHero();
  assertEqual(importHero(JSON.stringify(hero)), hero);
});

test(MODEL, 'Import meldet ungültige Dateien verständlich', () => {
  const invalid = assertThrows(() => importHero('{kein json'), HeroImportError);
  assertTrue(invalid.message.includes('JSON'), invalid.message);
  const other = assertThrows(() => importHero('{"foo": 1}'), HeroImportError);
  assertTrue(other.message.includes('kein DSA5-Held'), other.message);
});

test(MODEL, 'AW und INI: leer = automatisch, eigener Wert hat Vorrang', () => {
  const hero = testHero();
  assertEqual(dodgeOf(hero), 7, 'GE 13 → 7');
  assertEqual(initiativeBaseOf(hero), 13, '(12+13)/2 → 13');
  hero.base.aw = 9;
  hero.base.ini = 15;
  assertEqual(dodgeOf(hero), 9);
  assertEqual(initiativeBaseOf(hero), 15);
});

test(MODEL, 'Kampftechnik- und Waffenwerte', () => {
  const hero = testHero();
  const swords = hero.combatTechniques.find((t) => t.id === 'schwerter');
  swords.ktw = 12;
  assertEqual(techniqueValues(hero, swords), { at: 13, pa: 8, fk: null }, 'AT 12+1, PA 6+2 (KK 14)');
  swords.pa = 10;
  assertEqual(techniqueValues(hero, swords).pa, 10, 'eigener Wert');
  const bows = hero.combatTechniques.find((t) => t.id === 'boegen');
  assertEqual(techniqueValues(hero, bows), { at: null, pa: null, fk: 8 }, 'FK 6 + FF-Bonus 2');

  const sword = { ...createWeapon(), technique: 'schwerter', atMod: 1, paMod: -1 };
  assertEqual(weaponValues(hero, sword), { ranged: false, techniqueName: 'Schwerter', at: 14, pa: 9 });
  const bow = { ...createWeapon(), technique: 'boegen', atMod: -1 };
  assertEqual(weaponValues(hero, bow), { ranged: true, techniqueName: 'Bögen', fk: 7 });
});

test(MODEL, 'Zustände: Abzug, Abschalten, automatischer Schmerz', () => {
  const hero = testHero();
  hero.conditions.furcht = 2;
  hero.conditions.betaeubung = 1;
  assertEqual(conditionState(hero).penalty, -3);
  hero.conditionsOff.furcht = true;
  assertEqual(conditionState(hero).penalty, -1);
  assertEqual(describeConditions(hero), 'Betäubung I, Furcht II (aus)');
  hero.autoPain = true;
  hero.base.le = { current: 10, max: 30 };
  assertEqual(conditionState(hero).levels.schmerz, 2, 'LE 10 von 30 → Schmerz II');
  assertEqual(conditionState(hero).penalty, -3);
});

test(MODEL, 'AsP/KaP abziehen und zurückbuchen, nie unter 0', () => {
  const hero = testHero();
  hero.base.asp = { current: 10, max: 30 };
  assertEqual(payEnergy(hero, 'asp', 8), 8);
  assertEqual(hero.base.asp.current, 2);
  assertEqual(payEnergy(hero, 'asp', 8), 2, 'nur so viel wie vorhanden');
  assertEqual(hero.base.asp.current, 0);
  refundEnergy(hero, 'asp', 2);
  assertEqual(hero.base.asp.current, 2);
});

test(MODEL, 'Schicksalspunkt einsetzen', () => {
  const hero = testHero();
  hero.base.schip = { current: 1, max: 3 };
  assertEqual(spendFatePoint(hero), true);
  assertEqual(hero.base.schip.current, 0);
  assertEqual(spendFatePoint(hero), false, 'keiner mehr übrig');
  assertEqual(hero.base.schip.current, 0);
});

// ---------------------------------------------------------------------------
// Proben aus dem Heldenbogen
// ---------------------------------------------------------------------------

const CHECKS = 'Proben (checks.js)';

test(CHECKS, 'Talentprobe nutzt Heldenwerte (Pflichtfall 1 über den Heldenbogen)', () => {
  const hero = testHero();
  const climbing = talent(hero, 'klettern');
  climbing.check = ['MU', 'KL', 'IN']; // 12/13/11
  climbing.fw = 6;
  const record = rollSkill(hero, climbing, { label: 'Klettern', roll: fixedRolls([14, 9, 12]) });
  assertEqual(record.type, ROLL_TYPES.SKILL);
  assertEqual(record.actor, 'Alrik');
  assertEqual(record.result.remainingFp, 3);
  assertEqual(record.result.qs, 1);
  assertTrue(!Number.isNaN(Date.parse(record.time)), 'Zeitstempel');
});

test(CHECKS, 'Zustände fließen in den Modifikator ein (abschaltbar)', () => {
  const hero = testHero();
  hero.conditions.schmerz = 2;
  assertEqual(composeModifier(hero, 1), { manual: 1, conditions: -2, total: -1 });
  assertEqual(composeModifier(hero, 1, false), { manual: 1, conditions: 0, total: 1 });
  const entry = { check: ['MU', 'KL', 'IN'], fw: 6 };
  const record = rollSkill(hero, entry, { label: 'Test', roll: fixedRolls([14, 9, 12]) });
  assertEqual(record.result.targets, [10, 11, 9], 'Schmerz II → −2 auf alle drei');
  assertEqual(record.result.success, false);
});

test(CHECKS, 'Spezialisierung erhöht den FW um 2', () => {
  const hero = testHero();
  const entry = { check: ['MU', 'KL', 'IN'], fw: 6, spec: 'Eisklettern' };
  const record = rollSkill(hero, entry, {
    label: 'Klettern',
    modifier: -2,
    useSpecialization: true,
    roll: fixedRolls([14, 9, 12]),
  });
  assertEqual(record.result.fw, 8);
  assertEqual(record.result.remainingFp, 1, 'mit Spezialisierung doch gelungen');
  assertEqual(record.specialization, 'Eisklettern');
});

test(CHECKS, 'W20-Probe würfelt bei 1 oder 20 automatisch den Bestätigungswurf', () => {
  const hero = testHero();
  const critical = rollD20(hero, { type: ROLL_TYPES.COMBAT, label: 'AT', target: 14, roll: fixedRolls([1, 10]) });
  assertEqual(critical.result.confirmRoll, 10);
  assertEqual(critical.result.special, SPECIAL.CRITICAL);
  const normal = rollD20(hero, { type: ROLL_TYPES.ATTRIBUTE, label: 'MU', target: 12, roll: fixedRolls([7]) });
  assertEqual(normal.result.confirmRoll, null);
  assertEqual(normal.result.success, true);
});

test(CHECKS, 'Schaden, verdoppelt bei kritischem Treffer', () => {
  const hero = testHero();
  const weapon = { ...createWeapon(), name: 'Langschwert', tp: '1W6+4' };
  assertEqual(rollDamage(hero, weapon, { roll: fixedRolls([3]) }).result.total, 7);
  const doubled = rollDamage(hero, weapon, { double: true, roll: fixedRolls([3]) });
  assertEqual(doubled.result.subtotal, 7);
  assertEqual(doubled.result.total, 14);
  assertEqual(doubled.label, 'Schaden Langschwert');
});

test(CHECKS, 'Ungültige TP-Formel meldet einen verständlichen Fehler', () => {
  const weapon = { ...createWeapon(), tp: '1W6+x' };
  const error = assertThrows(() => rollDamage(testHero(), weapon));
  assertTrue(error.message.includes('kein gültiger Würfelausdruck'), error.message);
});

test(CHECKS, 'Freier Wurf und Initiative', () => {
  const free = rollFree('Meister', '2W6+3', { roll: fixedRolls([4, 5]) });
  assertEqual(free.label, '2W6+3');
  assertEqual(free.result.total, 12);
  const ini = rollInitiative(testHero(), { modifier: 1, roll: fixedRolls([4]) });
  assertEqual(ini.result, { kind: 'initiative', base: 13, roll: 4, modifier: 1, total: 18 });
});

test(CHECKS, 'Schicksalspunkt: gewählte Würfel neu, Ergebnis bindend', () => {
  const hero = testHero();
  const entry = { check: ['MU', 'KL', 'IN'], fw: 6 };
  const first = rollSkill(hero, entry, { label: 'Test', modifier: -2, roll: fixedRolls([14, 9, 12]) });
  assertEqual(first.result.success, false);
  const second = rerollWithFate(first, [0], { roll: fixedRolls([3]) });
  assertEqual(second.result.rolls, [3, 9, 12]);
  assertEqual(second.result.remainingFp, 3);
  assertEqual(second.result.success, true);
  assertEqual(second.fate.rerollOf, first.id);
  assertTrue(second.id !== first.id, 'neuer Protokolleintrag');
  assertTrue(fateRerollBlocker(second) !== null, 'kein zweiter Neuwurf');
  assertThrows(() => rerollWithFate(second, [1]));
});

test(CHECKS, 'Schicksalspunkt: nicht nach Patzer, nicht für Schaden', () => {
  const hero = testHero();
  const botch = rollSkill(hero, { check: ['MU', 'KL', 'IN'], fw: 10 }, { label: 'X', roll: fixedRolls([20, 20, 5]) });
  assertTrue(fateRerollBlocker(botch).includes('Patzer'), 'Patzer');
  const damage = rollDamage(hero, createWeapon(), { roll: fixedRolls([2]) });
  assertTrue(fateRerollBlocker(damage) !== null, 'Schaden');
});

test(CHECKS, 'Schicksalspunkt bei W20-Probe würfelt die ganze Probe neu', () => {
  const hero = testHero();
  const first = rollD20(hero, { type: ROLL_TYPES.COMBAT, label: 'PA', target: 8, roll: fixedRolls([15]) });
  const second = rerollWithFate(first, [0], { roll: fixedRolls([1, 3]) });
  assertEqual(second.result.roll, 1);
  assertEqual(second.result.confirmRoll, 3);
  assertEqual(second.result.special, SPECIAL.CRITICAL);
});

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

const FORMAT = 'Texte (format.js)';

test(FORMAT, 'Modifikatoren mit echtem Minuszeichen', () => {
  assertEqual(formatModifier(2), '+2');
  assertEqual(formatModifier(-3), '−3');
  assertEqual(formatModifier(0), '±0');
  assertEqual(describeModifier({ manual: -1, conditions: -2, total: -3 }), 'Mod −3 (Probe −1, Zustände −2)');
  assertEqual(describeModifier({ manual: 2, conditions: 0, total: 2 }), 'Mod +2');
});

test(FORMAT, 'Ergebnistexte', () => {
  const hero = testHero();
  const entry = { check: ['MU', 'KL', 'IN'], fw: 6 };
  const ok = rollSkill(hero, entry, { label: 'X', roll: fixedRolls([14, 9, 12]) });
  assertEqual(describeOutcome(ok.result), { text: 'Gelungen · QS 1', tone: 'success' });
  const crit = rollSkill(hero, entry, { label: 'X', roll: fixedRolls([1, 1, 18]) });
  assertEqual(describeOutcome(crit.result), { text: 'Kritischer Erfolg · QS 1', tone: 'critical' });
  const botch = rollSkill(hero, entry, { label: 'X', roll: fixedRolls([20, 20, 5]) });
  assertEqual(describeOutcome(botch.result), { text: 'Patzer', tone: 'botch' });
});

test(MODEL, 'Favoriten bleiben im Helden: Texte, ohne Doppelte, höchstens 30', () => {
  assertEqual(createHero().favorites, []);
  const hero = normalizeHero({ favorites: ['weapon:w1:at', 'dodge::', 'weapon:w1:at', 7, null, 'x'.repeat(200)] });
  assertEqual(hero.favorites, ['weapon:w1:at', 'dodge::']);
  assertEqual(normalizeHero({ favorites: 'kaputt' }).favorites, []);
  const many = Array.from({ length: 40 }, (_, index) => `talent:t${index}:`);
  assertEqual(normalizeHero({ favorites: many }).favorites.length, 30);
  assertEqual(importHero(exportHero({ ...createHero(), favorites: ['dodge::'] })).favorites, ['dodge::'], 'Sicherung');
});

test(
  MODEL,
  'Inventar-Gruppen: ältere Helden bekommen die vier Standardgruppen, Gegenstände bleiben, wo sie waren',
  () => {
    const hero = normalizeHero({ inventory: [{ name: 'Zelt', location: 'packtier' }] });
    assertEqual(
      hero.inventoryGroups.map(({ id, name }) => [id, name]),
      [
        ['koerper', 'Am Körper'],
        ['rucksack', 'Rucksack'],
        ['wagen', 'Wagen'],
        ['packtier', 'Packtier'],
      ],
    );
    assertEqual(hero.inventory[0].location, 'packtier');
    assertEqual(createHero().inventoryGroups.length, 4, 'neuer Held: Standardgruppen');
  },
);

test(MODEL, 'Inventar-Gruppen: eigene Gruppen bleiben, Gegenstände ohne Gruppe landen in der ersten', () => {
  const hero = normalizeHero({
    inventoryGroups: [
      { id: 'g1', name: '  Gürteltasche  ' },
      { id: 'g2', name: 'Truhe in Gareth'.repeat(5) },
      { id: 'g1', name: 'doppelt' },
      'Müll',
    ],
    inventory: [
      { name: 'Dietrich', location: 'g1' },
      { name: 'Seil', location: 'rucksack' },
      { name: 'Buch', location: 'g2' },
    ],
  });
  assertEqual(hero.inventoryGroups.length, 3, 'nur Objekte, doppelte ID neu vergeben');
  assertEqual(hero.inventoryGroups[0], { id: 'g1', name: 'Gürteltasche' });
  assertEqual(hero.inventoryGroups[1].name.length, 40, 'Name höchstens 40 Zeichen');
  assertTrue(hero.inventoryGroups[2].id !== 'g1');
  assertEqual(
    hero.inventory.map((item) => item.location),
    ['g1', 'g1', 'g2'],
    'Rucksack gibt es hier nicht mehr → erste Gruppe',
  );
  const many = normalizeHero({
    inventoryGroups: Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `G${i}` })),
  });
  assertEqual(many.inventoryGroups.length, MAX_INVENTORY_GROUPS);
  assertEqual(normalizeHero({ inventoryGroups: [] }).inventoryGroups.length, 4, 'leer → Standardgruppen');
  const group = createInventoryGroup();
  assertTrue(typeof group.id === 'string' && group.id.length > 0 && group.name === 'Neue Gruppe');
});

test(MODEL, 'Inventar-Gruppen: Umsortieren und Umbenennen bauen den Bogen neu auf, Gewicht nicht', () => {
  const hero = testHero();
  hero.inventory.push({ id: 'i1', name: 'Seil', count: 1, weight: 1.5, location: 'rucksack', note: '' });
  const before = structureSignature(hero);
  hero.inventory[0].weight = 3;
  assertEqual(structureSignature(hero), before, 'Gewicht: nur Werte');
  hero.inventory[0].location = 'wagen';
  assertTrue(structureSignature(hero) !== before, 'anderer Gruppe zugeordnet');
  const moved = structureSignature(hero);
  hero.inventoryGroups[1].name = 'Tornister';
  assertTrue(structureSignature(hero) !== moved, 'Gruppe umbenannt');
  assertEqual(importHero(exportHero(hero)), hero, 'Gruppen überstehen Export und Import');
});
