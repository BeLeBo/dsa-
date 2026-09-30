/**
 * dice.js – Würfeln mit kryptografisch sicherem Zufall und freie Würfelausdrücke.
 *
 * Zufall kommt ausschließlich aus crypto.getRandomValues (nie Math.random).
 * Alle Funktionen, die würfeln, akzeptieren optional eine eigene Würfelfunktion
 * `roll(sides) → Zahl`. So lassen sie sich mit festen Werten testen.
 */

/** Grenzen, damit Tippfehler wie „1000W6“ die App nicht einfrieren. */
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
export const MAX_CONSTANT = 10000;

const UINT32_RANGE = 2 ** 32;

/** Fehler in einem Würfelausdruck; die Nachricht ist für Menschen gedacht. */
export class DiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiceError';
  }
}

// ---------------------------------------------------------------------------
// Zufall
// ---------------------------------------------------------------------------

function randomUint32() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Dieser Browser bietet keinen sicheren Zufallsgenerator (crypto.getRandomValues).');
  }
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

/**
 * Gleichverteilte Ganzzahl von 1 bis max.
 * Werte oberhalb des größten Vielfachen von max werden verworfen,
 * damit kein Ergebnis durch den Modulo häufiger vorkommt als andere.
 */
export function randomInt(max) {
  if (!Number.isInteger(max) || max < 1 || max > UINT32_RANGE) {
    throw new RangeError(`Ungültige Obergrenze für Zufallszahl: ${max}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % max);
  let value;
  do {
    value = randomUint32();
  } while (value >= limit);
  return (value % max) + 1;
}

function assertSides(sides) {
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_SIDES) {
    throw new DiceError(`Ein Würfel braucht 2 bis ${MAX_SIDES} Seiten (erhalten: ${sides}).`);
  }
}

/** Ein Würfelwurf, z. B. rollDie(20) für einen W20. */
export function rollDie(sides) {
  assertSides(sides);
  return randomInt(sides);
}

/** Mehrere gleiche Würfel, z. B. rollDice(3, 20) für 3W20. */
export function rollDice(count, sides, roll = rollDie) {
  return Array.from({ length: count }, () => roll(sides));
}

// ---------------------------------------------------------------------------
// Würfelausdrücke wie „2W6+3“, „1W20“, „3W20“, „1W6+1W4-2“
// ---------------------------------------------------------------------------

const TERM_PATTERN = /^([+-])?(?:(\d*)W(\d+)|(\d+))/;

function invalidExpression(text) {
  return new DiceError(`„${text}“ ist kein gültiger Würfelausdruck. Beispiele: 1W20, 3W20, 2W6+3.`);
}

function parseDiceTerm(match, sign) {
  const count = match[2] === '' ? 1 : Number(match[2]);
  const sides = Number(match[3]);
  if (count < 1 || count > MAX_DICE) {
    throw new DiceError(`Die Anzahl der Würfel muss zwischen 1 und ${MAX_DICE} liegen.`);
  }
  assertSides(sides);
  return { sign, count, sides };
}

/** Normierte Schreibweise, z. B. { dice: [{sign:1,count:2,sides:6}], constant: 3 } → „2W6+3“. */
export function formatDiceExpression({ dice, constant }) {
  const diceText = dice
    .map(({ sign, count, sides }, index) => {
      const operator = sign < 0 ? '-' : index > 0 ? '+' : '';
      return `${operator}${count}W${sides}`;
    })
    .join('');
  if (constant === 0) return diceText;
  return `${diceText}${constant > 0 ? '+' : '-'}${Math.abs(constant)}`;
}

/**
 * Zerlegt einen Würfelausdruck. Erlaubt: „W“ oder „D“, Groß-/Kleinschreibung,
 * Leerzeichen, weggelassene Anzahl („W6“ = „1W6“), mehrere Würfelgruppen und Zahlen.
 * Wirft DiceError mit verständlicher Nachricht bei ungültiger Eingabe.
 */
export function parseDiceExpression(text) {
  const source = String(text ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/D/g, 'W');
  if (source === '') throw new DiceError('Bitte einen Würfelausdruck eingeben, z. B. 2W6+3.');

  const dice = [];
  let constant = 0;
  let rest = source;
  while (rest !== '') {
    const match = TERM_PATTERN.exec(rest);
    const isFirstTerm = rest === source;
    if (!match || (!isFirstTerm && !match[1])) throw invalidExpression(text);

    const sign = match[1] === '-' ? -1 : 1;
    if (match[3] !== undefined) dice.push(parseDiceTerm(match, sign));
    else constant += sign * Number(match[4]);
    rest = rest.slice(match[0].length);
  }

  if (dice.length === 0) throw new DiceError('Der Ausdruck enthält keinen Würfel, z. B. 1W6 oder 2W6+3.');
  if (dice.reduce((total, term) => total + term.count, 0) > MAX_DICE) {
    throw new DiceError(`Höchstens ${MAX_DICE} Würfel pro Wurf.`);
  }
  if (Math.abs(constant) > MAX_CONSTANT) {
    throw new DiceError(`Der Zuschlag darf höchstens ±${MAX_CONSTANT} betragen.`);
  }
  return { dice, constant, text: formatDiceExpression({ dice, constant }) };
}

/**
 * Würfelt einen zerlegten Ausdruck aus.
 * Ergebnis: { expression, groups: [{ sign, count, sides, rolls, subtotal }], modifier, total }
 */
export function evaluateDiceExpression(parsed, roll = rollDie) {
  const groups = parsed.dice.map(({ sign, count, sides }) => {
    const rolls = rollDice(count, sides, roll);
    const subtotal = sign * rolls.reduce((total, value) => total + value, 0);
    return { sign, count, sides, rolls, subtotal };
  });
  const total = groups.reduce((sum, group) => sum + group.subtotal, 0) + parsed.constant;
  return { expression: parsed.text, groups, modifier: parsed.constant, total };
}

/** Kurzform: Ausdruck zerlegen und direkt würfeln, z. B. rollExpression('1W6+4'). */
export function rollExpression(text, roll = rollDie) {
  return evaluateDiceExpression(parseDiceExpression(text), roll);
}
