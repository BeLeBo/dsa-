/**
 * combat.js (Ansicht) – Kampftechniken, Waffen und Rüstung.
 */
import { h } from '../dom.js';
import { field, textInput, intInput, selectInput } from '../fields.js';
import { section, actionButton, derived, editorToggle, addButton, removeButton, emptyHint } from './parts.js';
import { COMBAT_TECHNIQUES } from '../../data/talents.js';
import { techniqueInfo } from '../../sheet.js';

const VALUE_LABELS = { at: 'AT', pa: 'PA', fk: 'FK' };

function valueKeys(ranged) {
  return ranged ? ['fk'] : ['at', 'pa'];
}

function rollChip(action, id, key, derivedName, label) {
  return actionButton(
    action,
    `${id}|${key}`,
    [h('small', {}, VALUE_LABELS[key]), derived(derivedName, `${id}|${key}`)],
    {
      className: 'chip',
      label,
    },
  );
}

/** Schalter-Schlüssel: zeigt bei allen Kampftechniken die Felder für eigene Werte. */
const TECHNIQUE_EDITOR_KEY = 'techniques';

function techniqueRow(entry, index, editing) {
  const info = techniqueInfo(entry.id);
  const keys = valueKeys(info.ranged);
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'row-line' },
      h(
        'div',
        { class: 'row-text' },
        h('span', { class: 'row-name' }, info.name),
        h('span', { class: 'row-sub' }, info.leading.join('/')),
      ),
      field('KtW', intInput(`combatTechniques.${index}.ktw`, { label: `KtW ${info.name}` }), { className: 'row-fw' }),
      keys.map((key) =>
        rollChip('roll-technique', entry.id, key, 'technique-value', `${VALUE_LABELS[key]} ${info.name} würfeln`),
      ),
    ),
    editing
      ? h(
          'div',
          { class: 'row-editor grid grid-3' },
          keys.map((key) =>
            field(
              `${VALUE_LABELS[key]} (eigener Wert)`,
              intInput(`combatTechniques.${index}.${key}`, {
                optional: true,
                auto: `technique-auto:${entry.id}|${key}`,
              }),
            ),
          ),
        )
      : null,
  );
}

const TECHNIQUE_OPTIONS = COMBAT_TECHNIQUES.map(({ id, name, ranged }) => ({
  value: id,
  label: `${name}${ranged ? ' (Fernkampf)' : ''}`,
}));

function weaponRow(weapon, index, ui) {
  const ranged = techniqueInfo(weapon.technique).ranged;
  const editorKey = `weapon:${weapon.id}`;
  const editorOpen = ui.openEditors.has(editorKey);
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'row-line' },
      h(
        'div',
        { class: 'row-text' },
        derived('weapon-name', weapon.id, { className: 'row-name' }),
        derived('weapon-sub', weapon.id, { className: 'row-sub' }),
      ),
      editorToggle(editorKey, editorOpen, 'Waffe bearbeiten'),
    ),
    h(
      'div',
      { class: 'row-chips' },
      valueKeys(ranged).map((key) =>
        rollChip('roll-weapon', weapon.id, key, 'weapon-value', `${VALUE_LABELS[key]} mit Waffe würfeln`),
      ),
      actionButton('roll-damage', weapon.id, [h('small', {}, 'TP'), derived('weapon-tp', weapon.id)], {
        className: 'chip chip-wide',
        label: 'Schaden würfeln',
      }),
    ),
    editorOpen
      ? h(
          'div',
          { class: 'row-editor grid grid-2' },
          field('Name', textInput(`weapons.${index}.name`, { placeholder: 'z. B. Langschwert' }), {
            className: 'span-2',
          }),
          field('Kampftechnik', selectInput(`weapons.${index}.technique`, TECHNIQUE_OPTIONS, { structural: true }), {
            className: 'span-2',
          }),
          field('TP', textInput(`weapons.${index}.tp`, { placeholder: '1W6+4' })),
          field('Reichweite', textInput(`weapons.${index}.range`, { placeholder: ranged ? '10/50/80' : 'mittel' })),
          field(ranged ? 'FK-Mod' : 'AT-Mod', intInput(`weapons.${index}.atMod`, { signed: true })),
          ranged ? null : field('PA-Mod', intInput(`weapons.${index}.paMod`, { signed: true })),
          h('div', { class: 'span-2 row-actions' }, removeButton('weapons', weapon.id, 'Waffe löschen')),
        )
      : null,
  );
}

export function renderCombat(hero, ui) {
  const editingTechniques = ui.openEditors.has(TECHNIQUE_EDITOR_KEY);
  const techniques = hero.combatTechniques.map((entry, index) => techniqueRow(entry, index, editingTechniques));
  const weapons = hero.weapons.map((weapon, index) => weaponRow(weapon, index, ui));
  return section('kampf', 'Kampf', [
    h('h3', {}, 'Waffen'),
    weapons.length ? weapons : emptyHint('Noch keine Waffen eingetragen.'),
    addButton('weapons', 'Waffe hinzufügen'),
    h('h3', {}, 'Rüstung'),
    h(
      'div',
      { class: 'grid grid-3' },
      field('Rüstung', textInput('armor.name', { placeholder: 'z. B. Kettenhemd' }), { className: 'span-3' }),
      field('RS', intInput('armor.rs')),
      field('BE', intInput('armor.be')),
    ),
    h('h3', {}, 'Kampftechniken'),
    h('p', { class: 'section-hint' }, 'AT = KtW + MU-Bonus, PA = KtW/2 + Leiteigenschafts-Bonus, FK = KtW + FF-Bonus.'),
    actionButton('toggle-editor', TECHNIQUE_EDITOR_KEY, editingTechniques ? 'Anpassen beenden' : 'Werte anpassen', {
      className: `btn btn-small ${editingTechniques ? 'active' : ''}`.trim(),
    }),
    editingTechniques
      ? h('p', { class: 'section-hint' }, 'Eigene Werte überschreiben die Berechnung. Leeres Feld = automatisch.')
      : null,
    techniques,
  ]);
}
