/**
 * format.js – Texte für Probenergebnisse (rein, ohne DOM), genutzt von Dialog und Protokoll.
 */
import { SPECIAL_LABELS, isCriticalSuccess, isBotch } from './rules.js';

/** Zahl mit echtem Minuszeichen, z. B. −1 statt -1. */
export function formatNumber(value) {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/** „+2“, „−3“, „±0“ (mit echtem Minuszeichen). */
export function formatModifier(value) {
  if (value > 0) return `+${value}`;
  return value < 0 ? formatNumber(value) : '±0';
}

/**
 * Kurztext und Tonlage eines Ergebnisses.
 * tone: 'critical' | 'success' | 'failure' | 'botch' | 'neutral'
 */
export function describeOutcome(result) {
  if (result.kind === 'ausdruck' || result.kind === 'initiative') {
    return { text: `Ergebnis ${result.total}`, tone: 'neutral' };
  }
  const special = result.special ? SPECIAL_LABELS[result.special] : null;
  const qs = result.kind === 'fertigkeit' && result.success ? ` · QS ${result.qs}` : '';
  if (isCriticalSuccess(result.special)) return { text: `${special}${qs}`, tone: 'critical' };
  if (isBotch(result.special)) return { text: special, tone: 'botch' };
  if (result.success) return { text: `Gelungen${qs}`, tone: 'success' };
  return { text: 'Misslungen', tone: 'failure' };
}

/** „Mod −3 (Probe −1, Zustände −2)“ – nur die Teile, die nicht 0 sind. */
export function describeModifier(modifier) {
  if (!modifier) return '';
  const parts = [];
  if (modifier.manual) parts.push(`Probe ${formatModifier(modifier.manual)}`);
  if (modifier.conditions) parts.push(`Zustände ${formatModifier(modifier.conditions)}`);
  const detail = modifier.conditions ? ` (${parts.join(', ')})` : '';
  return `Mod ${formatModifier(modifier.total)}${detail}`;
}
