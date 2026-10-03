/**
 * combat-view.js – Kampfkarte im Tab „Gruppe“: Initiative-Reihenfolge, wer ist am Zug, Kampfrunde.
 * Der Meister startet und beendet den Kampf, klickt durch die Reihenfolge und fügt Gegner hinzu.
 * Spieler sehen die Reihenfolge live und würfeln ihre Initiative im Heldenbogen.
 */
import { h } from './dom.js';
import { confirmDialog } from './dialog.js';
import { orderedEntries, currentEntry, heroEntryId } from '../combat.js';
import { formatModifier } from '../format.js';
import { heroName, initiativeBaseOf, normalizeHero } from '../sheet.js';

function entryDetail(entry) {
  const modifier = entry.modifier ? ` ${formatModifier(entry.modifier)}` : '';
  return `INI ${entry.base} + W6 ${entry.roll}${modifier}`;
}

function initiativeRow(entry, position, { isCurrent, editing, isMine, actions }) {
  return h(
    'li',
    { class: `initiative-row ${isCurrent ? 'is-current' : ''} ${isMine ? 'is-mine' : ''}`.trim() },
    h('span', { class: 'initiative-position' }, String(position)),
    h(
      'div',
      { class: 'initiative-name' },
      h('strong', {}, entry.name),
      h('span', { class: 'row-sub' }, entryDetail(entry)),
    ),
    h('span', { class: 'initiative-total' }, String(entry.total)),
    editing
      ? h(
          'div',
          { class: 'initiative-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'step-button',
              'aria-label': `${entry.name}: Initiative −1`,
              onclick: () => actions.adjust(entry.id, -1),
            },
            '−',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'step-button',
              'aria-label': `${entry.name}: Initiative +1`,
              onclick: () => actions.adjust(entry.id, 1),
            },
            '+',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button danger',
              'aria-label': `${entry.name} entfernen`,
              onclick: () => actions.remove(entry.id),
            },
            '×',
          ),
        )
      : null,
  );
}

/**
 * Formular „Gegner / NSC“. Die Gruppenansicht legt es einmal an und setzt es bei jedem Neuaufbau
 * wieder ein – so gehen halb eingetippte Werte nicht verloren, wenn live etwas hereinkommt.
 */
export function createNpcForm(actions) {
  const form = h(
    'form',
    {
      class: 'npc-form',
      onsubmit: (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        actions.addNpc(values);
        form.reset();
      },
    },
    h(
      'label',
      { class: 'field grow' },
      h('span', { class: 'field-label' }, 'Gegner / NSC'),
      h('input', { type: 'text', name: 'name', placeholder: 'z. B. Ork', required: true, autocomplete: 'off' }),
    ),
    h(
      'label',
      { class: 'field narrow' },
      h('span', { class: 'field-label' }, 'INI-Basis'),
      h('input', { type: 'number', name: 'base', inputmode: 'numeric', class: 'num', required: true, min: 0 }),
    ),
    h(
      'label',
      { class: 'field narrow' },
      h('span', { class: 'field-label' }, 'Anzahl'),
      h('input', { type: 'number', name: 'count', inputmode: 'numeric', class: 'num', value: '1', min: 1, max: 20 }),
    ),
    h('button', { type: 'submit', class: 'btn' }, 'Hinzufügen'),
  );
  return form;
}

function missingHeroes(combat, characters, actions) {
  const missing = characters.filter(
    (character) => !combat.entries.some((entry) => entry.id === heroEntryId(character.id)),
  );
  if (missing.length === 0) return null;
  return h(
    'div',
    { class: 'initiative-missing' },
    h('p', { class: 'section-hint' }, 'Noch ohne Initiative – Spieler würfeln selbst, oder du würfelst für sie:'),
    h(
      'div',
      { class: 'chips' },
      missing.map((character) => {
        const hero = normalizeHero(character.data);
        return h(
          'button',
          { type: 'button', class: 'chip chip-wide', onclick: () => actions.rollHero(character.id) },
          h('small', {}, `INI ${initiativeBaseOf(hero)}`),
          heroName(hero),
        );
      }),
      missing.length > 1
        ? h(
            'button',
            { type: 'button', class: 'chip chip-wide', onclick: actions.rollAllHeroes },
            h('small', {}, 'alle'),
            'würfeln',
          )
        : null,
    ),
  );
}

/**
 * @param {object} options
 * @param {object|null} options.combat       laufender Kampf oder null
 * @param {boolean} options.isMaster
 * @param {object[]} options.characters      sichtbare Helden (Zeilen vom Server)
 * @param {string|null} options.myCharacterId eigener Held (für „Du bist am Zug“)
 * @param {boolean} options.editing       Meister: Werte anpassen und Einträge entfernen
 * @param {object} options.actions  { start, end, next, previous, adjust, remove, addNpc, rollHero, rollAllHeroes, toggleEditing }
 * @param {HTMLFormElement} [options.npcForm]  bleibendes Formular „Gegner / NSC“ (createNpcForm)
 */
export function renderCombatCard({
  combat,
  isMaster,
  characters,
  myCharacterId,
  editing = false,
  actions,
  npcForm = null,
}) {
  if (!combat) {
    if (!isMaster) return null;
    return h(
      'section',
      { class: 'card combat-card' },
      h('h2', {}, 'Kampf'),
      h(
        'p',
        { class: 'section-hint' },
        'Starte einen Kampf, um die Initiative-Reihenfolge für alle sichtbar zu führen.',
      ),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: actions.start }, 'Kampf beginnen'),
    );
  }

  const order = orderedEntries(combat);
  const current = currentEntry(combat);
  const myTurn = current && current.characterId && current.characterId === myCharacterId;
  const currentText = current ? (myTurn ? 'Du bist am Zug!' : `Am Zug: ${current.name}`) : 'Noch niemand am Zug.';

  return h(
    'section',
    { class: 'card combat-card' },
    h('h2', {}, `Kampf – Runde ${combat.round}`),
    h('p', { class: `combat-current ${myTurn ? 'is-mine' : ''}`.trim(), role: 'status' }, currentText),
    isMaster
      ? h(
          'div',
          { class: 'button-row' },
          h('button', { type: 'button', class: 'btn', onclick: actions.previous, disabled: !current }, '◀ Zurück'),
          h(
            'button',
            { type: 'button', class: 'btn btn-primary btn-large', onclick: actions.next, disabled: order.length === 0 },
            current ? 'Weiter ▶' : 'Start ▶',
          ),
        )
      : null,
    order.length
      ? h(
          'ol',
          { class: 'initiative-list' },
          order.map((entry, index) =>
            initiativeRow(entry, index + 1, {
              isCurrent: entry.id === combat.currentId,
              editing: isMaster && editing,
              isMine: Boolean(entry.characterId) && entry.characterId === myCharacterId,
              actions,
            }),
          ),
        )
      : h('p', { class: 'empty-hint' }, 'Noch keine Initiative gewürfelt.'),
    isMaster && order.length
      ? h(
          'button',
          {
            type: 'button',
            class: `btn btn-small combat-edit ${editing ? 'active' : ''}`.trim(),
            'aria-pressed': String(editing),
            onclick: actions.toggleEditing,
          },
          editing ? 'Bearbeiten beenden' : 'Werte anpassen / entfernen',
        )
      : null,
    isMaster ? missingHeroes(combat, characters, actions) : null,
    isMaster ? (npcForm ?? createNpcForm(actions)) : null,
    isMaster
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn-danger-outline combat-end',
            onclick: async () => {
              if (
                await confirmDialog('Kampf beenden? Die Reihenfolge wird für alle gelöscht.', {
                  confirmLabel: 'Beenden',
                  danger: true,
                })
              ) {
                actions.end();
              }
            },
          },
          'Kampf beenden',
        )
      : h(
          'p',
          { class: 'section-hint' },
          'Deine Initiative würfelst du im Heldenbogen (Basiswerte) oder im Tab „Würfeln“.',
        ),
  );
}
