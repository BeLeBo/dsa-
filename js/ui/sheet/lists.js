/**
 * lists.js (Ansicht) – Einfache Textlisten (Vorteile, Nachteile …), Inventar und Geld.
 * Das Inventar ist in Gruppen geordnet (Am Körper, Rucksack … und eigene wie „Gürteltasche“),
 * jede mit eigenem Gewicht; Gruppen lassen sich anlegen, umbenennen, verschieben und löschen.
 */
import { h, icon, ICONS } from '../dom.js';
import { field, textInput, intInput, decimalInput, selectInput } from '../fields.js';
import { section, collapsible, actionButton, derived, addButton, removeButton, emptyHint } from './parts.js';
import { COINS } from '../../rules.js';
import { TEXT_LISTS, MAX_INVENTORY_GROUPS, MAX_GROUP_NAME_LENGTH } from '../../sheet.js';

/** Zeilen einer Textliste { id, text } mit Löschknopf. */
export function textListRows(hero, key, placeholder) {
  if (hero[key].length === 0) return emptyHint('Noch keine Einträge.');
  return h(
    'div',
    { class: 'text-list' },
    hero[key].map((entry, index) =>
      h(
        'div',
        { class: 'text-list-row' },
        textInput(`${key}.${index}.text`, { placeholder, label: 'Eintrag' }),
        removeButton(key, entry.id, 'Eintrag löschen'),
      ),
    ),
  );
}

const PLACEHOLDERS = {
  advantages: 'z. B. Glück I',
  disadvantages: 'z. B. Neugier',
  specialAbilities: 'z. B. Finte I',
  languages: 'z. B. Garethi III, Kusliker Zeichen',
  tradeSecrets: 'z. B. Rezept: Heiltrank',
};

export function renderAbilities(hero) {
  return section(
    'faehigkeiten',
    'Vorteile, Nachteile & Fähigkeiten',
    TEXT_LISTS.map(({ key, name, single }) => [
      h('h3', {}, name),
      textListRows(hero, key, PLACEHOLDERS[key]),
      addButton(key, `${single} hinzufügen`),
    ]),
  );
}

const groupLabel = (group) => group.name || 'Gruppe ohne Namen';
const GROUP_BUTTON_LABELS = Object.freeze({ '-1': 'nach oben', 1: 'nach unten' });
const groupButtonLabel = (group, what) => `Gruppe „${groupLabel(group)}“ ${what}`;

/**
 * Neuer Gruppenname, ohne den Bogen neu aufzubauen (sonst ginge ein Tipp verloren, der gerade
 * das Namensfeld verlässt): Kopfzeile, Auswahllisten der Gegenstände und Knopf-Beschriftungen.
 */
export function showGroupName(root, group) {
  const label = groupLabel(group);
  for (const element of root.querySelectorAll(
    `[data-group="${group.id}"] > summary .inventory-group-name, option[value="${group.id}"]`,
  )) {
    element.textContent = label;
  }
  const buttons = `[data-action$="-group"][data-arg="${group.id}"], [data-action$="-group"][data-arg^="${group.id}:"]`;
  for (const button of root.querySelectorAll(buttons)) {
    const step = button.dataset.arg.split(':')[1];
    button.setAttribute('aria-label', groupButtonLabel(group, step ? GROUP_BUTTON_LABELS[step] : 'löschen'));
  }
}

function itemRow(item, index, groupOptions) {
  const base = `inventory.${index}`;
  return h(
    'div',
    { class: 'item' },
    h(
      'div',
      { class: 'item-line' },
      field('Gegenstand', textInput(`${base}.name`, { placeholder: 'z. B. Seil (10 Schritt)' }), { className: 'grow' }),
      field('Anzahl', decimalInput(`${base}.count`), { className: 'narrow' }),
      field('Stein', decimalInput(`${base}.weight`), { className: 'narrow' }),
    ),
    h(
      'div',
      { class: 'item-line' },
      field('Gruppe', selectInput(`${base}.location`, groupOptions, { structural: true })),
      field('Notiz', textInput(`${base}.note`), { className: 'grow' }),
      removeButton('inventory', item.id, 'Gegenstand löschen'),
    ),
  );
}

/** Name ändern, nach oben/unten, löschen – unten in jeder Gruppe. */
function groupSettings(group, index, count) {
  const move = (step, text, label) => {
    const button = actionButton('move-group', `${group.id}:${step}`, text, { className: 'icon-button', label });
    button.disabled = index + step < 0 || index + step >= count;
    return button;
  };
  return h(
    'div',
    { class: 'inventory-group-settings' },
    field(
      'Name der Gruppe',
      h('input', {
        type: 'text',
        value: group.name,
        maxlength: MAX_GROUP_NAME_LENGTH,
        placeholder: 'z. B. Gürteltasche',
        autocomplete: 'off',
        dataset: { groupName: group.id },
      }),
      { className: 'grow' },
    ),
    move(-1, '↑', groupButtonLabel(group, GROUP_BUTTON_LABELS[-1])),
    move(1, '↓', groupButtonLabel(group, GROUP_BUTTON_LABELS[1])),
    count > 1
      ? actionButton('remove-group', group.id, icon(ICONS.trash), {
          className: 'icon-button danger',
          label: groupButtonLabel(group, 'löschen'),
        })
      : null,
  );
}

function inventoryGroup(hero, group, index, groupOptions) {
  const items = hero.inventory
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => item.location === group.id);
  return collapsible(
    `inventar:${group.id}`,
    [
      h('span', { class: 'inventory-group-name' }, groupLabel(group)),
      derived('inventory-group', group.id, { className: 'inventory-group-meta' }),
    ],
    h(
      'div',
      { class: 'inventory-group-body' },
      items.length
        ? items.map(({ item, itemIndex }) => itemRow(item, itemIndex, groupOptions))
        : emptyHint('Noch nichts in dieser Gruppe.'),
      actionButton('add-item', group.id, [icon(ICONS.plus), h('span', {}, 'Gegenstand hinzufügen')], {
        className: 'btn btn-add',
      }),
      groupSettings(group, index, hero.inventoryGroups.length),
    ),
    { className: 'inventory-group', dataset: { group: group.id } },
  );
}

export function renderInventory(hero) {
  const groupOptions = hero.inventoryGroups.map((group) => ({ value: group.id, label: groupLabel(group) }));
  const coins = h(
    'div',
    { class: 'grid grid-4' },
    COINS.map(({ id, name }) => field(name, intInput(`money.${id}`, { label: name }))),
  );
  return section('inventar', 'Inventar & Geld', [
    h(
      'p',
      { class: 'section-hint' },
      'Gegenstände in Gruppen ordnen – eigene Gruppen wie „Gürteltasche“ oder „Truhe in Gareth“ mit „Gruppe hinzufügen“.',
    ),
    h(
      'div',
      { class: 'inventory-groups' },
      hero.inventoryGroups.map((group, index) => inventoryGroup(hero, group, index, groupOptions)),
    ),
    hero.inventoryGroups.length < MAX_INVENTORY_GROUPS
      ? actionButton('add-group', '', [icon(ICONS.plus), h('span', {}, 'Gruppe hinzufügen')], {
          className: 'btn btn-add',
        })
      : null,
    h('div', { class: 'weight total' }, h('span', {}, 'Gesamtgewicht'), derived('weight-total', '', { tag: 'strong' })),
    h('h3', {}, 'Geld'),
    h('p', { class: 'section-hint' }, '1 Dukat = 10 Silbertaler = 100 Heller = 1000 Kreuzer'),
    coins,
    h(
      'div',
      { class: 'money-footer' },
      derived('money-total', '', { className: 'readout' }),
      actionButton('exchange-money', '', 'Münzen wechseln', { className: 'btn btn-small' }),
    ),
  ]);
}
