/**
 * fixtures.js – Hilfen für deterministische Tests.
 */

/** Würfelfunktion, die feste Werte der Reihe nach liefert. */
export function fixedRolls(values) {
  const queue = [...values];
  return () => {
    if (queue.length === 0) throw new Error('Keine festen Würfelwerte mehr übrig');
    return queue.shift();
  };
}
