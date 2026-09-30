/**
 * roll-view.js – Darstellung eines Protokolleintrags: Einzelwürfel, Modifikator, Ergebnis.
 * Genutzt im Probendialog (ausführlich) und im Protokoll (kompakt + aufklappbar).
 */
import { h } from './dom.js';
import { describeOutcome, describeModifier, formatModifier, formatNumber } from '../format.js';
import { formatTime } from '../util.js';

function outcomeBanner(result) {
  const { text, tone } = describeOutcome(result);
  return h('div', { class: `outcome tone-${tone}` }, text);
}

function dieClass(value, over) {
  return ['die', over ? 'die-over' : 'die-ok', value === 1 ? 'die-one' : '', value === 20 ? 'die-twenty' : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * Würfel einer Fertigkeitsprobe. Mit `selection` werden sie zu Auswahlknöpfen
 * (Schicksalspunkt: welche Würfel neu werfen?).
 */
function skillDice(record, selection) {
  const { rolls, targets, excess } = record.result;
  return h(
    'div',
    { class: 'dice' },
    rolls.map((value, index) => {
      const content = [
        h('span', { class: 'die-attr' }, record.check?.[index] ?? ''),
        h('span', { class: 'die-value' }, String(value)),
        h('span', { class: 'die-target' }, `≤ ${targets[index]}`),
        excess[index] > 0 ? h('span', { class: 'die-excess' }, `−${excess[index]}`) : null,
      ];
      if (!selection) return h('div', { class: dieClass(value, excess[index] > 0) }, content);
      const selected = selection.selected.has(index);
      return h(
        'button',
        {
          type: 'button',
          class: `${dieClass(value, excess[index] > 0)} die-selectable ${selected ? 'die-selected' : ''}`,
          'aria-pressed': String(selected),
          onclick: () => selection.onToggle(index),
        },
        content,
      );
    }),
  );
}

function skillDetails(record, selection) {
  const { result } = record;
  const spent = result.excess.reduce((sum, value) => sum + value, 0);
  const specialization = record.specialization ? ` (inkl. Spezialisierung „${record.specialization}“ +2)` : '';
  return [
    skillDice(record, selection),
    h(
      'p',
      { class: 'roll-line' },
      `FW ${result.fw}${specialization} − ${spent} = ${formatNumber(result.remainingFp)} FP übrig`,
    ),
  ];
}

function d20Details(record) {
  const { result } = record;
  const target = result.modifier
    ? `Zielwert ${result.target} ${formatModifier(result.modifier)} = ${result.effective}`
    : `Zielwert ${result.effective}`;
  const dice = [
    h('div', { class: dieClass(result.roll, !result.success) }, h('span', { class: 'die-value' }, String(result.roll))),
  ];
  if (result.confirmRoll !== null) {
    const confirmed = result.confirmRoll <= result.effective;
    dice.push(
      h(
        'div',
        { class: `die die-confirm ${confirmed ? 'die-ok' : 'die-over'}` },
        h('span', { class: 'die-attr' }, 'Bestätigung'),
        h('span', { class: 'die-value' }, String(result.confirmRoll)),
        h('span', { class: 'die-target' }, confirmed ? 'gelungen' : 'misslungen'),
      ),
    );
  }
  return [h('div', { class: 'dice' }, dice), h('p', { class: 'roll-line' }, target)];
}

function expressionDetails(result) {
  const parts = result.groups.map((group) => {
    const sign = group.sign < 0 ? '− ' : '';
    return `${sign}${group.count}W${group.sides}: ${group.rolls.join(' + ')}`;
  });
  if (result.modifier) parts.push(formatModifier(result.modifier));
  const doubled = result.multiplier > 1 ? ` → × ${result.multiplier} = ${result.total}` : '';
  return [
    h(
      'div',
      { class: 'dice' },
      result.groups.flatMap((group) =>
        group.rolls.map((value) =>
          h('div', { class: 'die die-plain' }, h('span', { class: 'die-value' }, String(value))),
        ),
      ),
    ),
    h('p', { class: 'roll-line' }, `${parts.join(' · ')} = ${formatNumber(result.subtotal)}${doubled}`),
  ];
}

function initiativeDetails(result) {
  const modifier = result.modifier ? ` ${formatModifier(result.modifier)}` : '';
  return [
    h(
      'div',
      { class: 'dice' },
      h('div', { class: 'die die-plain' }, h('span', { class: 'die-value' }, String(result.roll))),
    ),
    h(
      'p',
      { class: 'roll-line' },
      `INI ${result.base} + 1W6 (${result.roll})${modifier} = ${formatNumber(result.total)}`,
    ),
  ];
}

function resultDetails(record, selection) {
  switch (record.result.kind) {
    case 'fertigkeit':
      return skillDetails(record, selection);
    case 'w20':
      return d20Details(record);
    case 'initiative':
      return initiativeDetails(record.result);
    default:
      return expressionDetails(record.result);
  }
}

function fateNote(record) {
  if (!record.fate) return null;
  const previous = record.fate.previous.rolls ?? [record.fate.previous.roll];
  return h('p', { class: 'roll-note' }, `Neuwurf mit Schicksalspunkt – vorher: ${previous.join(' / ')}`);
}

/**
 * Ausführliche Darstellung (Probendialog, aufgeklapptes Protokoll).
 * @param {object} record
 * @param {object} [selection] { selected: Set<number>, onToggle(index) } für die Würfelauswahl
 */
export function renderRollDetails(record, selection = null) {
  const modifier = describeModifier(record.modifier);
  return h(
    'div',
    { class: 'roll-details' },
    outcomeBanner(record.result),
    resultDetails(record, selection),
    modifier ? h('p', { class: 'roll-line muted' }, modifier) : null,
    fateNote(record),
  );
}

/** Kurzfassung der Würfel für die Protokollzeile, z. B. „14 · 9 · 12“. */
function diceSummary(result) {
  switch (result.kind) {
    case 'fertigkeit':
      return result.rolls.join(' · ');
    case 'w20':
      return result.confirmRoll === null ? String(result.roll) : `${result.roll} (Best. ${result.confirmRoll})`;
    case 'initiative':
      return `${result.base} + ${result.roll}`;
    default:
      return result.groups.flatMap((group) => group.rolls).join(' · ');
  }
}

/** Protokolleintrag: Kopfzeile mit Name, Uhrzeit, Probe und Ergebnis; aufklappbar. */
export function renderLogEntry(record) {
  const { text, tone } = describeOutcome(record.result);
  return h(
    'details',
    { class: 'log-entry' },
    h(
      'summary',
      {},
      h(
        'div',
        { class: 'log-head' },
        h('span', { class: 'log-actor' }, record.actor),
        h('time', { datetime: record.time }, formatTime(record.time)),
      ),
      h(
        'div',
        { class: 'log-main' },
        h('span', { class: 'log-label' }, record.fate ? `${record.label} (Schicksalspunkt)` : record.label),
        h('span', { class: `log-outcome tone-${tone}` }, text),
      ),
      h('div', { class: 'log-dice' }, `Würfel: ${diceSummary(record.result)}`),
    ),
    renderRollDetails(record),
  );
}
