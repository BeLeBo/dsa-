/**
 * talents.js (Ansicht) – Talente nach Gruppen, mit Suche, Probe per Tipp und Bearbeiten-Bereich.
 */
import { h } from '../dom.js';
import { field, textInput, intInput, selectInput } from '../fields.js';
import { section, actionButton, derived, editorToggle, searchField } from './parts.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES } from '../../rules.js';
import { TALENT_GROUPS } from '../../data/talents.js';
import { talentInfo } from '../../sheet.js';

export const ATTRIBUTE_OPTIONS = ATTRIBUTES.map((code) => ({
  value: code,
  label: `${code} – ${ATTRIBUTE_NAMES[code]}`,
}));

/** Drei Auswahllisten für die Probeneigenschaften eines Eintrags. */
export function checkEditor(basePath, name) {
  return h(
    'div',
    { class: 'grid grid-3' },
    [0, 1, 2].map((index) =>
      field(
        `Eigenschaft ${index + 1}`,
        selectInput(`${basePath}.check.${index}`, ATTRIBUTE_OPTIONS, { label: `${name}: Eigenschaft ${index + 1}` }),
      ),
    ),
  );
}

function talentRow(talent, index, ui) {
  const info = talentInfo(talent.id);
  const editorKey = `talent:${talent.id}`;
  const editorOpen = ui.openEditors.has(editorKey);
  return h(
    'div',
    { class: 'row', dataset: { searchRow: '', searchText: info.name } },
    h(
      'div',
      { class: 'row-line' },
      actionButton(
        'roll-talent',
        talent.id,
        [h('span', { class: 'row-name' }, info.name), derived('talent-sub', talent.id, { className: 'row-sub' })],
        {
          className: 'row-main',
          label: `Probe auf ${info.name}`,
        },
      ),
      field('FW', intInput(`talents.${index}.fw`, { label: `FW ${info.name}` }), { className: 'row-fw' }),
      editorToggle(editorKey, editorOpen, `${info.name} bearbeiten`),
    ),
    editorOpen
      ? h(
          'div',
          { class: 'row-editor' },
          checkEditor(`talents.${index}`, info.name),
          field('Spezialisierung (FW +2)', textInput(`talents.${index}.spec`, { placeholder: 'z. B. Eisklettern' })),
        )
      : null,
  );
}

export function renderTalents(hero, ui) {
  const groups = TALENT_GROUPS.map((group) => {
    const rows = hero.talents
      .map((talent, index) => ({ talent, index }))
      .filter(({ talent }) => talentInfo(talent.id).group === group.id)
      .map(({ talent, index }) => talentRow(talent, index, ui));
    const groupSection = section(`talente-${group.id}`, group.name, rows, {
      className: 'subsection',
      badge: h('span', { class: 'badge' }, String(rows.length)),
    });
    groupSection.dataset.searchGroup = '';
    return groupSection;
  });

  return section('talente', 'Talente', [
    searchField('talente', ui.search.talente ?? '', 'Talent suchen …'),
    h('div', { dataset: { searchScope: 'talente' } }, groups),
  ]);
}
