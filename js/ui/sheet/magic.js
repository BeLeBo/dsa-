/**
 * magic.js (Ansicht) – Zauber, Rituale, Liturgien, Zeremonien und Zaubertricks.
 */
import { h } from '../dom.js';
import { field, textInput, intInput, selectInput } from '../fields.js';
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
import { infoKey, infoToggle, infoPanel } from './info.js';
import { SPELL_TYPES } from '../../data/talents.js';
import { DESCRIPTION_KINDS } from '../../descriptions.js';

const TYPE_OPTIONS = SPELL_TYPES.map(({ id, name }) => ({ value: id, label: name }));

function spellRow(spell, index, ui) {
  const editorKey = `spell:${spell.id}`;
  const editorOpen = ui.openEditors.has(editorKey);
  const infoOpen = ui.openEditors.has(infoKey('spells', spell.id));
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
      infoToggle(infoKey('spells', spell.id), infoOpen, spell.name || 'diesem Eintrag'),
      editorToggle(editorKey, editorOpen, 'Eintrag bearbeiten'),
    ),
    infoOpen
      ? infoPanel({ kinds: DESCRIPTION_KINDS.spells, namePath: `${base}.name`, notePath: `${base}.note` })
      : null,
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
    textListRows(hero, 'cantrips', 'z. B. Funkenflug', ui),
    addButton('cantrips', 'Zaubertrick hinzufügen'),
  ]);
}
