/**
 * general.js – Bereiche Allgemein, Eigenschaften, Basiswerte und Zustände.
 */
import { h } from '../dom.js';
import { field, textInput, textArea, intInput, selectInput, checkbox, stepper } from '../fields.js';
import { section, actionButton, derived } from './parts.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES, CONDITIONS, EXPERIENCE_LEVELS, MAX_CONDITION_LEVEL } from '../../rules.js';

export function renderGeneral() {
  const experienceOptions = EXPERIENCE_LEVELS.map(({ name, ap }) => ({ value: name, label: `${name} (${ap} AP)` }));
  return section(
    'allgemein',
    'Allgemein',
    h(
      'div',
      { class: 'grid grid-2' },
      field('Name', textInput('general.name'), { className: 'span-2' }),
      field('Spezies', textInput('general.species')),
      field('Kultur', textInput('general.culture')),
      field('Profession', textInput('general.profession'), { className: 'span-2' }),
      field('Erfahrungsgrad', selectInput('general.experience', experienceOptions), {
        className: 'span-2',
        hint: { dataset: { derived: 'ap-level' } },
      }),
      h(
        'div',
        { class: 'grid grid-3 span-2 align-end' },
        field('AP gesamt', intInput('general.apTotal')),
        field('AP ausgegeben', intInput('general.apSpent')),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'AP übrig'),
          derived('ap-remaining', '', { className: 'readout' }),
        ),
      ),
      field('Aussehen', textArea('general.appearance', { rows: 2 }), { className: 'span-2' }),
      field('Notizen', textArea('general.notes', { rows: 4 }), { className: 'span-2' }),
    ),
  );
}

export function renderAttributes() {
  const tiles = ATTRIBUTES.map((code) =>
    h(
      'div',
      { class: 'attribute' },
      actionButton('roll-attribute', code, [h('strong', {}, code), h('small', {}, ATTRIBUTE_NAMES[code])], {
        className: 'attribute-roll',
        label: `Eigenschaftsprobe ${ATTRIBUTE_NAMES[code]}`,
      }),
      intInput(`attributes.${code}`, { label: ATTRIBUTE_NAMES[code], className: 'attribute-value' }),
    ),
  );
  return section('eigenschaften', 'Eigenschaften', [
    h('p', { class: 'section-hint' }, 'Tippe auf eine Eigenschaft für eine Eigenschaftsprobe.'),
    h('div', { class: 'attributes' }, tiles),
  ]);
}

function poolRow(key, label) {
  return h(
    'div',
    { class: 'pool' },
    h('span', { class: 'pool-label' }, label),
    stepper(`base.${key}.current`, { label: `${label} aktuell` }),
    h('span', { class: 'pool-separator' }, '/'),
    intInput(`base.${key}.max`, { label: `${label} maximal`, className: 'pool-max' }),
  );
}

export function renderBase() {
  return section(
    'basiswerte',
    'Basiswerte',
    h(
      'div',
      { class: 'stack' },
      poolRow('le', 'LE'),
      poolRow('asp', 'AsP'),
      poolRow('kap', 'KaP'),
      poolRow('schip', 'SchiP'),
      h(
        'div',
        { class: 'grid grid-3' },
        field('SK', intInput('base.sk', { signed: true })),
        field('ZK', intInput('base.zk', { signed: true })),
        field('GS', intInput('base.gs')),
        field('AW', intInput('base.aw', { optional: true, auto: 'dodge' }), {
          hint: { text: 'leer = GE/2' },
        }),
        field('INI', intInput('base.ini', { optional: true, auto: 'ini-base' }), {
          hint: { text: 'leer = (MU+GE)/2' },
        }),
      ),
      h(
        'div',
        { class: 'button-row' },
        actionButton('roll-dodge', '', ['Ausweichen ', derived('dodge')]),
        actionButton('roll-initiative', '', ['Initiative ', derived('ini-base'), ' + 1W6']),
      ),
    ),
  );
}

export function renderConditions() {
  const rows = CONDITIONS.map(({ id, name }) =>
    h(
      'div',
      { class: 'condition' },
      h('span', { class: 'condition-name' }, name),
      stepper(`conditions.${id}`, { label: name, min: 0, max: MAX_CONDITION_LEVEL, display: 'roman' }),
      checkbox(`conditionsOff.${id}`, 'ignorieren', { className: 'condition-off' }),
    ),
  );
  return section('zustaende', 'Zustände', [
    h('div', { class: 'conditions' }, rows),
    h(
      'div',
      { class: 'auto-pain' },
      checkbox('autoPain', 'Schmerz automatisch aus LE'),
      derived('pain-from-le', '', { className: 'muted' }),
    ),
    h(
      'p',
      { class: 'section-hint' },
      'Je Stufe −1 auf Proben. Mit Automatik zählt ein eingetragener Schmerz zusätzlich (z. B. durch Gift).',
    ),
    derived('condition-summary', '', { tag: 'p', className: 'readout' }),
  ]);
}
