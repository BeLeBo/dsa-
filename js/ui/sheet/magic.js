/**
 * magic.js (Ansicht) – Zauber, Rituale, Liturgien, Zeremonien und Zaubertricks.
 */
import { h } from '../dom.js';
import { field, textInput, textArea, intInput, selectInput } from '../fields.js';
import {
  section,
  actionButton,
  derived,
  editorToggle,
  addButton,
  removeButton,
  searchField,
  emptyHint,
} from './parts.js';
import { checkEditor } from './talents.js';
import { textListRows } from './lists.js';
import { SPELL_TYPES } from '../../data/talents.js';

const TYPE_OPTIONS = SPELL_TYPES.map(({ id, name }) => ({ value: id, label: name }));

function spellRow(spell, index, ui) {
  const editorKey = `spell:${spell.id}`;
  const editorOpen = ui.openEditors.has(editorKey);
  const base = `spells.${index}`;
  return h(
    'div',
    { class: 'row', dataset: { searchRow: '', searchPath: `${base}.name` } },
    h(
      'div',
      { class: 'row-line' },
      actionButton(
        'roll-spell',
        spell.id,
        [
          derived('spell-name', spell.id, { className: 'row-name' }),
          derived('spell-sub', spell.id, { className: 'row-sub' }),
        ],
        {
          className: 'row-main',
          label: 'Probe würfeln',
        },
      ),
      field('FW', intInput(`${base}.fw`, { label: 'Fertigkeitswert' }), { className: 'row-fw' }),
      editorToggle(editorKey, editorOpen, 'Eintrag bearbeiten'),
    ),
    editorOpen
      ? h(
          'div',
          { class: 'row-editor' },
          h(
            'div',
            { class: 'grid grid-2' },
            field('Name', textInput(`${base}.name`, { placeholder: 'z. B. Ignifaxius' }), { className: 'span-2' }),
            field('Art', selectInput(`${base}.type`, TYPE_OPTIONS)),
            field('Kosten', textInput(`${base}.cost`, { placeholder: 'z. B. 8 AsP' })),
          ),
          checkEditor(base, 'Zauber'),
          h(
            'div',
            { class: 'grid grid-3' },
            field('Zauberdauer', textInput(`${base}.castingTime`, { placeholder: '2 Aktionen' })),
            field('Reichweite', textInput(`${base}.range`, { placeholder: '8 Schritt' })),
            field('Wirkungsdauer', textInput(`${base}.duration`, { placeholder: 'sofort' })),
          ),
          field('Notiz', textArea(`${base}.note`, { rows: 2 })),
          h('div', { class: 'row-actions' }, removeButton('spells', spell.id, 'Eintrag löschen')),
        )
      : null,
  );
}

export function renderMagic(hero, ui) {
  const rows = hero.spells.map((spell, index) => spellRow(spell, index, ui));
  return section('magie', 'Zauber & Liturgien', [
    rows.length
      ? [
          searchField('magie', ui.search.magie ?? '', 'Zauber oder Liturgie suchen …'),
          h('div', { dataset: { searchScope: 'magie' } }, rows),
        ]
      : emptyHint('Noch keine Zauber, Rituale oder Liturgien eingetragen.'),
    addButton('spells', 'Zauber / Liturgie hinzufügen'),
    h('h3', {}, 'Zaubertricks & Segnungen'),
    textListRows(hero, 'cantrips', 'z. B. Funkenflug'),
    addButton('cantrips', 'Zaubertrick hinzufügen'),
  ]);
}
