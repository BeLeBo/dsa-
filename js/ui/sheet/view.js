/**
 * view.js – Der Heldenbogen: baut alle Bereiche auf, hält sie aktuell
 * und behandelt Knöpfe (Proben, Hinzufügen, Löschen, Bearbeiten).
 */
import { setChildren } from '../dom.js';
import { refreshValues, bindFields } from '../fields.js';
import { showToast } from '../toast.js';
import { handleRollClick } from '../roll-actions.js';
import { refreshDerived } from './derived.js';
import { applySearch } from './parts.js';
import { renderGeneral, renderAttributes, renderBase, renderConditions } from './general.js';
import { renderTalents } from './talents.js';
import { renderCombat } from './combat.js';
import { renderMagic } from './magic.js';
import { renderAbilities, renderInventory } from './lists.js';
import { createWeapon, createSpell, createTextEntry, createItem, TEXT_LISTS } from '../../sheet.js';
import { moneyToKreuzer, kreuzerToMoney } from '../../rules.js';

/** Neue Einträge je Liste; Listen mit Bearbeiten-Bereich öffnen ihn gleich. */
const LIST_FACTORIES = {
  weapons: { create: createWeapon, editor: 'weapon' },
  spells: { create: createSpell, editor: 'spell' },
  cantrips: { create: createTextEntry },
  inventory: { create: createItem },
  ...Object.fromEntries(TEXT_LISTS.map(({ key }) => [key, { create: createTextEntry }])),
};

function entryLabel(entry) {
  return entry.name || entry.text || 'Eintrag';
}

/**
 * @param {HTMLElement} root
 * @param {object} store  Heldenspeicher
 * @param {object} options { openCheck(spec) }
 */
export function createSheetView(root, store, { openCheck }) {
  const ui = { openEditors: new Set(), search: {} };

  function applySearches() {
    for (const [id, query] of Object.entries(ui.search)) applySearch(root, id, query, store.hero);
  }

  function refresh() {
    refreshValues(root, store.hero);
    refreshDerived(root, store.hero);
  }

  function render() {
    const scrollY = window.scrollY;
    const hero = store.hero;
    setChildren(
      root,
      renderGeneral(),
      renderAttributes(),
      renderBase(),
      renderConditions(),
      renderTalents(hero, ui),
      renderCombat(hero, ui),
      renderMagic(hero, ui),
      renderAbilities(hero),
      renderInventory(hero),
    );
    refresh();
    applySearches();
    window.scrollTo(0, scrollY);
  }

  function focusEntry(listKey, index) {
    root.querySelector(`[data-path^="${listKey}.${index}."]`)?.focus();
  }

  function addEntry(listKey) {
    const factory = LIST_FACTORIES[listKey];
    const entry = factory.create();
    store.hero[listKey].push(entry);
    if (factory.editor) ui.openEditors.add(`${factory.editor}:${entry.id}`);
    store.changed('structure', root);
    focusEntry(listKey, store.hero[listKey].length - 1);
  }

  function removeEntry(arg) {
    const [listKey, id] = arg.split(':');
    const index = store.hero[listKey].findIndex((entry) => entry.id === id);
    if (index === -1) return;
    const [removed] = store.hero[listKey].splice(index, 1);
    store.changed('structure', root);
    showToast(`„${entryLabel(removed)}“ gelöscht`, {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          const list = store.hero[listKey];
          list.splice(Math.min(index, list.length), 0, removed);
          store.changed('structure', root);
        },
      },
    });
  }

  const ACTIONS = {
    'toggle-editor': (key) => {
      if (ui.openEditors.has(key)) ui.openEditors.delete(key);
      else ui.openEditors.add(key);
      render();
    },
    'add-entry': addEntry,
    'remove-entry': removeEntry,
    'exchange-money': () => {
      store.hero.money = kreuzerToMoney(moneyToKreuzer(store.hero.money));
      store.changed('value', null);
    },
  };

  bindFields(root, store);

  root.addEventListener('click', (event) => {
    if (handleRollClick(event, root, openCheck)) return;
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button)) return;
    ACTIONS[button.dataset.action]?.(button.dataset.arg ?? '');
  });

  root.addEventListener('input', (event) => {
    const id = event.target.dataset?.search;
    if (!id) return;
    ui.search[id] = event.target.value;
    applySearch(root, id, event.target.value, store.hero);
  });

  store.subscribe((kind, source) => {
    if (kind !== 'value') {
      render();
    } else if (source instanceof Element && root.contains(source)) {
      // Eigene Eingabe: nur berechnete Anzeigen nachziehen, Felder bleiben unangetastet.
      refreshDerived(root, store.hero);
      applySearches();
    } else {
      refresh();
    }
  });

  render();
  return { render, refresh };
}
