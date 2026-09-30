/**
 * lists.js (Ansicht) – Einfache Textlisten (Vorteile, Nachteile …), Inventar und Geld.
 */
import { h } from '../dom.js';
import { field, textInput, intInput, decimalInput, selectInput } from '../fields.js';
import { section, actionButton, derived, addButton, removeButton, emptyHint } from './parts.js';
import { COINS, INVENTORY_LOCATIONS } from '../../rules.js';
import { TEXT_LISTS } from '../../sheet.js';

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

const LOCATION_OPTIONS = INVENTORY_LOCATIONS.map(({ id, name }) => ({ value: id, label: name }));

function itemRow(item, index) {
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
      field('Ort', selectInput(`${base}.location`, LOCATION_OPTIONS)),
      field('Notiz', textInput(`${base}.note`), { className: 'grow' }),
      removeButton('inventory', item.id, 'Gegenstand löschen'),
    ),
  );
}

export function renderInventory(hero) {
  const totals = h(
    'div',
    { class: 'weights' },
    INVENTORY_LOCATIONS.map(({ id, name }) =>
      h('div', { class: 'weight' }, h('span', {}, name), derived('weight', id, { tag: 'strong' })),
    ),
    h('div', { class: 'weight total' }, h('span', {}, 'Gesamt'), derived('weight-total', '', { tag: 'strong' })),
  );
  const coins = h(
    'div',
    { class: 'grid grid-4' },
    COINS.map(({ id, name }) => field(name, intInput(`money.${id}`, { label: name }))),
  );
  return section('inventar', 'Inventar & Geld', [
    hero.inventory.length ? hero.inventory.map(itemRow) : emptyHint('Noch keine Gegenstände.'),
    addButton('inventory', 'Gegenstand hinzufügen'),
    h('h3', {}, 'Gewicht je Ort'),
    totals,
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
