/**
 * rules.js – Reine Regel-Logik für „Das Schwarze Auge 5“.
 *
 * Grundsätze:
 *  - Kein DOM, kein Zufall, keine Seiteneffekte. Würfelergebnisse werden immer
 *    von außen übergeben (siehe dice.js) – dadurch ist jede Regel testbar.
 *  - Modifikatoren: positiv = Erleichterung, negativ = Erschwernis.
 *  - Alle Ergebnisse sind einfache, JSON-fähige Objekte (für Protokoll & Sync).
 */

// ---------------------------------------------------------------------------
// Stammdaten
// ---------------------------------------------------------------------------

/** Die acht Eigenschaften in Heldenbogen-Reihenfolge. */
export const ATTRIBUTES = Object.freeze(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);

export const ATTRIBUTE_NAMES = Object.freeze({
  MU: 'Mut',
  KL: 'Klugheit',
  IN: 'Intuition',
  CH: 'Charisma',
  FF: 'Fingerfertigkeit',
  GE: 'Gewandtheit',
  KO: 'Konstitution',
  KK: 'Körperkraft',
});

/** Zustände, jeweils mit Stufe 0–IV. */
export const CONDITIONS = Object.freeze([
  { id: 'schmerz', name: 'Schmerz' },
  { id: 'belastung', name: 'Belastung' },
  { id: 'betaeubung', name: 'Betäubung' },
  { id: 'furcht', name: 'Furcht' },
  { id: 'paralyse', name: 'Paralyse' },
  { id: 'verwirrung', name: 'Verwirrung' },
]);

export const MAX_CONDITION_LEVEL = 4;

/** DSA5: Die Summe aller Zustandsabzüge beträgt höchstens −5. */
export const MAX_CONDITION_PENALTY = 5;

/** Römische Stufenbezeichnungen für die Anzeige (Index = Stufe). */
export const ROMAN_LEVELS = Object.freeze(['0', 'I', 'II', 'III', 'IV']);

/** Besondere Ausgänge einer Probe. */
export const SPECIAL = Object.freeze({
  CRITICAL: 'kritisch',
  SPECTACULAR: 'spektakulaer',
  BOTCH: 'patzer',
  SPECTACULAR_BOTCH: 'spektakulaerer_patzer',
});

export const SPECIAL_LABELS = Object.freeze({
  [SPECIAL.CRITICAL]: 'Kritischer Erfolg',
  [SPECIAL.SPECTACULAR]: 'Spektakulärer Erfolg',
  [SPECIAL.BOTCH]: 'Patzer',
  [SPECIAL.SPECTACULAR_BOTCH]: 'Spektakulärer Patzer',
});

/** Erfahrungsgrade mit den AP, ab denen sie gelten. */
export const EXPERIENCE_LEVELS = Object.freeze([
  { name: 'Unerfahren', ap: 900 },
  { name: 'Durchschnittlich', ap: 1000 },
  { name: 'Erfahren', ap: 1100 },
  { name: 'Kompetent', ap: 1200 },
  { name: 'Meisterlich', ap: 1400 },
  { name: 'Brillant', ap: 1700 },
  { name: 'Legendär', ap: 2000 },
]);

/** Münzen mit ihrem Wert in Kreuzern: 1 D = 10 S = 100 H = 1000 K. */
export const COINS = Object.freeze([
  { id: 'dukaten', name: 'Dukaten', short: 'D', value: 1000 },
  { id: 'silbertaler', name: 'Silbertaler', short: 'S', value: 100 },
  { id: 'heller', name: 'Heller', short: 'H', value: 10 },
  { id: 'kreuzer', name: 'Kreuzer', short: 'K', value: 1 },
]);

/** Aufbewahrungsorte im Inventar. Der erste Ort ist der Standard. */
export const INVENTORY_LOCATIONS = Object.freeze([
  { id: 'koerper', name: 'Am Körper' },
  { id: 'rucksack', name: 'Rucksack' },
  { id: 'wagen', name: 'Wagen' },
  { id: 'packtier', name: 'Packtier' },
]);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Wandelt Eingaben (auch Strings aus Formularfeldern) in eine Ganzzahl um. */
export function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/** Wandelt Eingaben in eine Kommazahl um; akzeptiert auch „1,5“. */
export function toNumber(value, fallback = 0) {
  const number = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(number) ? number : fallback;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function countValue(values, wanted) {
  return values.filter((value) => value === wanted).length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Wirft einen verständlichen Fehler, wenn ein Würfelwert nicht zum Würfel passt. */
export function assertDieValue(value, sides) {
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new RangeError(`Ungültiger Würfelwert „${value}“ für einen W${sides}.`);
  }
}

// ---------------------------------------------------------------------------
// Fertigkeitsprobe (Talente, Zauber, Rituale, Liturgien) – 3W20
// ---------------------------------------------------------------------------

/**
 * Qualitätsstufe aus den übrigen Fertigkeitspunkten einer gelungenen Probe:
 * 0–3 → 1, 4–6 → 2, 7–9 → 3, 10–12 → 4, 13–15 → 5, 16+ → 6.
 * Negative Werte (kritischer Erfolg trotz fehlender FP) ergeben QS 1.
 */
export function qualityLevel(remainingFp) {
  return clamp(Math.ceil(toInt(remainingFp) / 3), 1, 6);
}

/** Erkennt kritische Erfolge und Patzer anhand der drei W20. */
export function skillCheckSpecial(rolls) {
  const ones = countValue(rolls, 1);
  const twenties = countValue(rolls, 20);
  if (ones === 3) return SPECIAL.SPECTACULAR;
  if (ones === 2) return SPECIAL.CRITICAL;
  if (twenties === 3) return SPECIAL.SPECTACULAR_BOTCH;
  if (twenties === 2) return SPECIAL.BOTCH;
  return null;
}

export function isCriticalSuccess(special) {
  return special === SPECIAL.CRITICAL || special === SPECIAL.SPECTACULAR;
}

export function isBotch(special) {
  return special === SPECIAL.BOTCH || special === SPECIAL.SPECTACULAR_BOTCH;
}

function assertThree(list, message) {
  if (!Array.isArray(list) || list.length !== 3) throw new RangeError(message);
}

/**
 * Fertigkeitsprobe mit 3W20.
 * Jeder Wurf wird gegen eine (modifizierte) Eigenschaft verglichen; liegt er
 * darüber, wird die Differenz vom FW abgezogen. Rest-FP ≥ 0 = gelungen.
 *
 * @param {object}   probe
 * @param {number[]} probe.attributes drei Eigenschaftswerte
 * @param {number}   probe.fw         Fertigkeitswert
 * @param {number}   [probe.modifier] Erleichterung (+) / Erschwernis (−) auf alle drei Eigenschaften
 * @param {number[]} probe.rolls      drei W20-Ergebnisse
 */
export function skillCheck({ attributes, fw, modifier = 0, rolls }) {
  assertThree(attributes, 'Eine Fertigkeitsprobe braucht genau drei Eigenschaften.');
  assertThree(rolls, 'Eine Fertigkeitsprobe braucht genau drei Würfe mit dem W20.');
  rolls.forEach((roll) => assertDieValue(roll, 20));

  const mod = toInt(modifier);
  const baseAttributes = attributes.map((value) => toInt(value));
  const targets = baseAttributes.map((value) => value + mod);
  const excess = rolls.map((roll, index) => Math.max(0, roll - targets[index]));
  const skillValue = toInt(fw);
  const remainingFp = skillValue - sum(excess);
  const special = skillCheckSpecial(rolls);
  const success = isCriticalSuccess(special) || (!isBotch(special) && remainingFp >= 0);

  return {
    kind: 'fertigkeit',
    attributes: baseAttributes,
    modifier: mod,
    targets,
    rolls: [...rolls],
    excess,
    fw: skillValue,
    remainingFp,
    success,
    qs: success ? qualityLevel(remainingFp) : 0,
    special,
  };
}

// ---------------------------------------------------------------------------
// Probe mit einem W20 (Eigenschaft, AT, PA, Ausweichen, Fernkampf)
// ---------------------------------------------------------------------------

/** Bei einer 1 oder 20 ist ein Bestätigungswurf nötig. */
export function needsConfirmation(roll) {
  return roll === 1 || roll === 20;
}

/**
 * W20-Probe gegen einen Zielwert. Eine 1 gelingt immer, eine 20 misslingt immer.
 * Gelingt der Bestätigungswurf nach einer 1 → kritischer Erfolg;
 * misslingt er nach einer 20 → Patzer.
 *
 * @param {object} probe
 * @param {number} probe.target        Eigenschafts- oder Kampfwert
 * @param {number} [probe.modifier]    Erleichterung (+) / Erschwernis (−)
 * @param {number} probe.roll          W20-Ergebnis
 * @param {number} [probe.confirmRoll] Bestätigungswurf, Pflicht bei 1 oder 20
 */
export function d20Check({ target, modifier = 0, roll, confirmRoll = null }) {
  assertDieValue(roll, 20);
  const confirmationNeeded = needsConfirmation(roll);
  if (confirmationNeeded) {
    if (confirmRoll == null) throw new RangeError('Bei einer 1 oder 20 fehlt der Bestätigungswurf.');
    assertDieValue(confirmRoll, 20);
  }

  const base = toInt(target);
  const mod = toInt(modifier);
  const effective = base + mod;
  const success = roll === 1 || (roll !== 20 && roll <= effective);
  const confirmed = confirmationNeeded ? confirmRoll <= effective : null;

  let special = null;
  if (roll === 1 && confirmed) special = SPECIAL.CRITICAL;
  if (roll === 20 && !confirmed) special = SPECIAL.BOTCH;

  return {
    kind: 'w20',
    target: base,
    modifier: mod,
    effective,
    roll,
    confirmRoll: confirmationNeeded ? confirmRoll : null,
    success,
    special,
  };
}

// ---------------------------------------------------------------------------
// Schicksalspunkte
// ---------------------------------------------------------------------------

/**
 * DSA5: Mit einem Schicksalspunkt dürfen ein, zwei oder alle Würfel einer Probe
 * neu geworfen werden – nicht aber bei einem Patzer. Das neue Ergebnis ist bindend.
 */
export function canRerollWithFate(result) {
  return !isBotch(result.special);
}

/** Ersetzt einzelne Würfel: replacements = { Index: neuerWert }. */
export function replaceDice(rolls, replacements) {
  return rolls.map((roll, index) => (Object.hasOwn(replacements, index) ? replacements[index] : roll));
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

/** Initiative einer Kampfrunde: INI-Basis + 1W6 (+ Modifikator). */
export function initiativeTotal(base, roll, modifier = 0) {
  assertDieValue(roll, 6);
  return toInt(base) + roll + toInt(modifier);
}

/**
 * Kampfreihenfolge: höchste Initiative zuerst. Bei Gleichstand gewinnt der
 * höhere INI-Basiswert, danach der höhere Stechwurf (tiebreak), zuletzt der Name.
 * Einträge: { name, base, total, tiebreak? }
 */
export function sortInitiative(entries) {
  return [...entries].sort(
    (a, b) =>
      b.total - a.total ||
      b.base - a.base ||
      (b.tiebreak ?? 0) - (a.tiebreak ?? 0) ||
      String(a.name).localeCompare(String(b.name), 'de'),
  );
}

// ---------------------------------------------------------------------------
// Abgeleitete Kampfwerte
// ---------------------------------------------------------------------------

/** Bonus einer Leiteigenschaft: +1 je volle 3 Punkte über 8 (11–13 → +1, 14–16 → +2 …). */
export function attributeBonus(value) {
  return Math.max(0, Math.floor((toInt(value) - 8) / 3));
}

/** Attacke = Kampftechnikwert + MU-Bonus. */
export function attackValue(ktw, mu) {
  return toInt(ktw) + attributeBonus(mu);
}

/** Parade = Kampftechnikwert / 2 (aufgerundet) + Bonus der höchsten Leiteigenschaft. */
export function parryValue(ktw, leadingAttributeValues) {
  const values = [].concat(leadingAttributeValues).map((value) => toInt(value));
  const best = values.length > 0 ? Math.max(...values) : 0;
  return Math.ceil(toInt(ktw) / 2) + attributeBonus(best);
}

/** Fernkampf = Kampftechnikwert + FF-Bonus. */
export function rangedValue(ktw, ff) {
  return toInt(ktw) + attributeBonus(ff);
}

/** Ausweichen = GE / 2 (kaufmännisch gerundet). */
export function dodgeValue(ge) {
  return Math.round(toInt(ge) / 2);
}

/** INI-Basiswert = (MU + GE) / 2 (kaufmännisch gerundet). */
export function initiativeBase(mu, ge) {
  return Math.round((toInt(mu) + toInt(ge)) / 2);
}

// ---------------------------------------------------------------------------
// Zustände
// ---------------------------------------------------------------------------

export function clampConditionLevel(level) {
  return clamp(toInt(level), 0, MAX_CONDITION_LEVEL);
}

/**
 * Schmerzstufe aus der Lebensenergie:
 * I bei ≤ ¾, II bei ≤ ½, III bei ≤ ¼ der maximalen LE, IV bei ≤ 5 LE.
 */
export function painLevelFromLe(current, max) {
  const le = toInt(current);
  const leMax = toInt(max);
  if (leMax <= 0) return 0;
  if (le <= 5) return 4;
  if (le <= leMax / 4) return 3;
  if (le <= leMax / 2) return 2;
  if (le <= (leMax * 3) / 4) return 1;
  return 0;
}

/**
 * Wirksame Zustandsstufen. Mit autoPain wird Schmerz aus der LE berechnet;
 * ein eingetragener Schmerz zählt dann zusätzlich (z. B. durch Gift), höchstens IV.
 */
export function effectiveConditionLevels(levels = {}, { autoPain = false, le = 0, leMax = 0 } = {}) {
  const result = {};
  for (const { id } of CONDITIONS) result[id] = clampConditionLevel(levels[id]);
  if (autoPain) result.schmerz = clampConditionLevel(result.schmerz + painLevelFromLe(le, leMax));
  return result;
}

/**
 * Gesamtabzug durch Zustände: −1 je Stufe, höchstens −5.
 * @param {object} levels    z. B. { schmerz: 2, furcht: 1 }
 * @param {object} [ignored] z. B. { furcht: true } → Furcht wird nicht eingerechnet
 */
export function conditionPenalty(levels = {}, ignored = {}) {
  const total = sum(CONDITIONS.map(({ id }) => (ignored[id] ? 0 : clampConditionLevel(levels[id]))));
  return 0 - Math.min(MAX_CONDITION_PENALTY, total);
}

// ---------------------------------------------------------------------------
// Zauber & Liturgien
// ---------------------------------------------------------------------------

/** Liest die erste Zahl aus einer Kostenangabe wie „8 AsP“; ohne Zahl → null. */
export function parseCost(text) {
  const match = /\d+/.exec(String(text ?? ''));
  return match ? Number(match[0]) : null;
}

/**
 * Tatsächlich zu zahlende Kosten: voll bei Erfolg, bei misslungener Probe
 * die Hälfte (kaufmännisch gerundet, mindestens 1).
 */
export function costToPay(cost, success) {
  const full = Math.max(0, toInt(cost));
  if (success || full === 0) return full;
  return Math.max(1, Math.round(full / 2));
}

// ---------------------------------------------------------------------------
// Abenteuerpunkte
// ---------------------------------------------------------------------------

export function apRemaining(total, spent) {
  return toInt(total) - toInt(spent);
}

/** Erfahrungsgrad passend zur Gesamt-AP (unter 900 AP: „Unerfahren“). */
export function experienceLevel(apTotal) {
  const ap = toInt(apTotal);
  let level = EXPERIENCE_LEVELS[0];
  for (const candidate of EXPERIENCE_LEVELS) {
    if (ap >= candidate.ap) level = candidate;
  }
  return level.name;
}

// ---------------------------------------------------------------------------
// Geld & Gewicht
// ---------------------------------------------------------------------------

/** Gesamtvermögen in Kreuzern, z. B. { dukaten: 1, heller: 2 } → 1020. */
export function moneyToKreuzer(money = {}) {
  return sum(COINS.map(({ id, value }) => toInt(money[id]) * value));
}

/** Verteilt Kreuzer auf möglichst große Münzen. Negative Beträge ergeben 0. */
export function kreuzerToMoney(total) {
  let rest = Math.max(0, toInt(total));
  const money = {};
  for (const { id, value } of COINS) {
    money[id] = Math.floor(rest / value);
    rest -= money[id] * value;
  }
  return money;
}

/** Kurzschreibweise, z. B. „3 D 2 S 5 K“; leerer Beutel → „0 K“. */
export function formatMoney(money = {}) {
  const parts = COINS.filter(({ id }) => toInt(money[id]) !== 0).map(({ id, short }) => `${toInt(money[id])} ${short}`);
  return parts.length > 0 ? parts.join(' ') : '0 K';
}

/**
 * Gewicht (Stein) je Aufbewahrungsort und insgesamt.
 * Gegenstände: { weight, count, location }; unbekannter Ort zählt als „Am Körper“.
 */
export function weightByLocation(items = []) {
  const byLocation = Object.fromEntries(INVENTORY_LOCATIONS.map(({ id }) => [id, 0]));
  for (const item of items) {
    const location = Object.hasOwn(byLocation, item.location) ? item.location : INVENTORY_LOCATIONS[0].id;
    byLocation[location] += toNumber(item.weight) * toNumber(item.count ?? 1);
  }
  for (const id of Object.keys(byLocation)) byLocation[id] = roundTo(byLocation[id], 3);
  return { byLocation, total: roundTo(sum(Object.values(byLocation)), 3) };
}
