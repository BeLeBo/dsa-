/**
 * roll-actions.js – Übersetzt Knöpfe mit data-action="roll-…" in eine Probenbeschreibung
 * für den Probendialog. Wird vom Heldenbogen und vom Würfeln-Tab genutzt.
 */

const SPEC_BUILDERS = {
  'roll-attribute': (arg) => ({ kind: 'attribute', code: arg }),
  'roll-talent': (arg) => ({ kind: 'talent', id: arg }),
  'roll-spell': (arg) => ({ kind: 'spell', id: arg }),
  'roll-dodge': () => ({ kind: 'dodge' }),
  'roll-initiative': () => ({ kind: 'initiative' }),
  'roll-technique': (arg) => {
    const [id, value] = arg.split('|');
    return { kind: 'technique', id, value };
  },
  'roll-weapon': (arg) => {
    const [id, value] = arg.split('|');
    return { kind: 'weapon', id, value };
  },
  'roll-damage': (arg) => ({ kind: 'damage', id: arg }),
};

/**
 * Behandelt einen Klick; liefert true, wenn es ein Würfelknopf war.
 * @param {MouseEvent} event
 * @param {HTMLElement} root
 * @param {(spec: object) => void} openCheck
 */
export function handleRollClick(event, root, openCheck) {
  const button = event.target.closest('[data-action]');
  if (!button || !root.contains(button)) return false;
  const build = SPEC_BUILDERS[button.dataset.action];
  if (!build) return false;
  openCheck(build(button.dataset.arg ?? ''));
  return true;
}
