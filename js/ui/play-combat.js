/**
 * play-combat.js – Kampf auf dem Spielbildschirm (über der Karte), live für alle:
 *  - Reihenfolge als Leiste, wer am Zug ist, Kampfrunde.
 *  - Meister: Weiter/Zurück, Gegner hinzufügen (gleich von der Karte), für fehlende Helden würfeln, beenden.
 *  - Spieler: großer Knopf „Initiative würfeln“, solange die eigene fehlt; danach die Favoriten
 *    (z. B. Angriffe und Paraden) als Schnellknöpfe.
 * Kampfstand und Aktionen kommen aus room-combat.js (dieselben wie im Tab „Gruppe“).
 */
import { h, setChildren } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { orderedEntries, currentEntry, heroEntryId } from '../combat.js';
import { heroName, initiativeBaseOf, normalizeHero } from '../sheet.js';
import { checkChoices, choicesByKeys } from '../check-search.js';
import { readJson, writeJson } from '../storage.js';

/** Zuletzt benutzte INI-Basis je Gegnerart (z. B. „Ork“) – für den nächsten Kampf. */
const INI_KEY = 'dsa5.kampf.ini';

/** „Ork 2“ → „Ork“: Gegner mit gleichem Namen (bis auf die Nummer) zusammenfassen. */
export function enemyGroup(name) {
  return (
    String(name ?? '')
      .replace(/\s+\d+$/, '')
      .trim() || 'Gegner'
  );
}

/**
 * Gegner/NSC von der Karte, die noch nicht im Kampf sind – nach Art gruppiert.
 * @returns {{ group: string, names: string[] }[]}
 */
export function enemiesFromTokens(tokens, combat) {
  const present = new Set((combat?.entries ?? []).map((entry) => entry.name));
  const groups = new Map();
  for (const token of tokens) {
    if (token.character_id || present.has(token.name)) continue;
    const group = enemyGroup(token.name);
    groups.set(group, [...(groups.get(group) ?? []), token.name]);
  }
  return [...groups].map(([group, names]) => ({ group, names }));
}

/**
 * Meister: Gegner zum Kampf hinzufügen – die von der Karte mit einem Tipp (INI-Basis je Art,
 * wird gemerkt), weitere über Name/INI/Anzahl.
 */
export function openEnemiesDialog({ tokens, combat, actions }) {
  const dialog = openDialog({ title: 'Gegner in den Kampf' });
  const remembered = readJson(INI_KEY, {}) ?? {};
  const groups = enemiesFromTokens(tokens, combat);
  const inputs = new Map();

  function addGroup({ group, names }) {
    const base = inputs.get(group)?.value;
    if (base === '' || base === undefined) return false;
    remembered[group] = Number(base);
    writeJson(INI_KEY, remembered);
    actions.addNpcs(names.map((name) => ({ name, base })));
    return true;
  }

  const groupRows = groups.map((entry) => {
    const input = h('input', {
      type: 'number',
      class: 'num',
      inputmode: 'numeric',
      min: 0,
      value: remembered[entry.group] ?? '',
      placeholder: 'INI',
      'aria-label': `INI-Basis ${entry.group}`,
    });
    inputs.set(entry.group, input);
    return h(
      'li',
      { class: 'enemy-row' },
      h(
        'span',
        { class: 'enemy-name' },
        h('strong', {}, entry.group),
        h('span', { class: 'row-sub' }, entry.names.length > 1 ? `${entry.names.length} Figuren` : entry.names[0]),
      ),
      input,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: (event) => {
            if (addGroup(entry)) event.target.closest('li').remove();
            else input.focus();
          },
        },
        'Hinzufügen',
      ),
    );
  });

  const freeName = h('input', { type: 'text', placeholder: 'z. B. Räuber', autocomplete: 'off', 'aria-label': 'Name' });
  const freeBase = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 0,
    placeholder: 'INI',
    'aria-label': 'INI-Basis',
  });
  const freeCount = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 1,
    max: 20,
    value: '1',
    'aria-label': 'Anzahl',
  });

  setChildren(
    dialog.body,
    groups.length
      ? [
          h('h3', {}, 'Von der Karte'),
          h('p', { class: 'section-hint' }, 'INI-Basis eintragen – sie wird für den nächsten Kampf gemerkt.'),
          h('ul', { class: 'enemy-list' }, groupRows),
        ]
      : h('p', { class: 'section-hint' }, 'Auf der Karte stehen keine weiteren Gegner.'),
    h('h3', {}, 'Weitere Gegner'),
    h(
      'div',
      { class: 'enemy-free' },
      freeName,
      freeBase,
      freeCount,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            if (!freeName.value.trim() || freeBase.value === '') return freeName.focus();
            actions.addNpc({ name: freeName.value, base: freeBase.value, count: freeCount.value });
            freeName.value = '';
            freeCount.value = '1';
          },
        },
        'Hinzufügen',
      ),
    ),
  );
  setChildren(
    dialog.footer,
    groups.length
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              const missing = groups.filter((entry) => !addGroup(entry));
              if (missing.length === 0) dialog.close();
              else inputs.get(missing[0].group).focus();
            },
          },
          'Alle von der Karte',
        )
      : null,
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Fertig'),
  );
}

/**
 * @param {object} options
 * @param {object} options.room                    Observable { combat, characters }
 * @param {() => boolean} options.isMaster
 * @param {() => string|null} options.openHeroId   auf diesem Gerät geöffneter Held
 * @param {() => object|null} options.openHero     dessen Daten (Store)
 * @param {object} options.actions                 Kampfaktionen (room-combat.js)
 * @param {(spec: object) => void} options.openCheck  Probendialog
 * @param {() => object[]} options.mapTokens       Figuren der angezeigten Karte (für „+ Gegner“)
 */
export function createCombatStrip({ room, isMaster, openHeroId, openHero, actions, openCheck, mapTokens }) {
  const element = h('section', { class: 'play-combat', 'aria-label': 'Kampf', hidden: true });
  let renderedKey = '';

  const button = (label, onclick, extra = {}) =>
    h('button', { type: 'button', class: extra.class ?? 'btn btn-small', onclick, ...extra.attrs }, label);

  function orderList(combat, mine) {
    const current = combat.currentId;
    return h(
      'ol',
      { class: 'play-combat-order' },
      orderedEntries(combat).map((entry) =>
        h(
          'li',
          {
            class: [
              'play-combat-entry',
              entry.id === current ? 'is-current' : '',
              mine && entry.characterId === mine ? 'is-mine' : '',
            ]
              .filter(Boolean)
              .join(' '),
          },
          h('span', { class: 'play-combat-name' }, entry.name),
          h('span', { class: 'play-combat-total' }, String(entry.total)),
        ),
      ),
    );
  }

  function masterTools(combat) {
    const order = orderedEntries(combat);
    const current = currentEntry(combat);
    const missing = room
      .get()
      .characters.filter((character) => !combat.entries.some((entry) => entry.id === heroEntryId(character.id)));
    return [
      h(
        'div',
        { class: 'play-combat-actions' },
        button('◀', actions.previous, { attrs: { 'aria-label': 'Zurück', disabled: !current } }),
        button(current ? 'Weiter ▶' : 'Start ▶', actions.next, {
          class: 'btn btn-primary',
          attrs: { disabled: order.length === 0 },
        }),
        button('+ Gegner', () => openEnemiesDialog({ tokens: mapTokens(), combat: room.get().combat, actions })),
        button('Ende', async () => {
          if (
            await confirmDialog('Kampf beenden? Die Reihenfolge wird für alle gelöscht.', {
              confirmLabel: 'Beenden',
              danger: true,
            })
          ) {
            actions.end();
          }
        }),
      ),
      missing.length
        ? h(
            'p',
            { class: 'play-combat-missing' },
            `Noch ohne Initiative: ${missing.map((character) => heroName(normalizeHero(character.data))).join(', ')} `,
            button('für sie würfeln', actions.rollAllHeroes),
          )
        : null,
    ];
  }

  function playerTools(combat, hero, heroId) {
    const hasInitiative = combat.entries.some((entry) => entry.id === heroEntryId(heroId));
    if (!hasInitiative) {
      return h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary btn-large play-combat-initiative',
          onclick: () => openCheck({ kind: 'initiative' }),
        },
        `🎲 Initiative würfeln (INI ${initiativeBaseOf(hero)} + 1W6)`,
      );
    }
    const favorites = choicesByKeys(checkChoices(hero), hero.favorites);
    return h(
      'div',
      { class: 'play-combat-favorites' },
      favorites.length
        ? favorites.map((choice) =>
            h(
              'button',
              {
                type: 'button',
                class: 'chip play-combat-favorite',
                'aria-label': `Favorit: ${choice.name}`,
                onclick: () => openCheck(choice.spec),
              },
              h('span', {}, choice.name),
              h('small', {}, choice.value ?? ''),
            ),
          )
        : h('p', { class: 'section-hint' }, 'Tipp: Unter „Proben“ mit ☆ deine Angriffe merken – dann stehen sie hier.'),
    );
  }

  function render() {
    const combat = room.get().combat;
    const heroId = openHeroId();
    const hero = openHero();
    const key = JSON.stringify([
      combat,
      isMaster(),
      heroId,
      hero ? [hero.favorites, hero.weapons, hero.combatTechniques, hero.attributes, hero.base.aw, hero.base.ini] : null,
      isMaster() ? room.get().characters.map((character) => character.id) : null,
    ]);
    if (key === renderedKey) return;
    renderedKey = key;
    element.hidden = !combat;
    if (!combat) return;
    const current = currentEntry(combat);
    const myTurn = Boolean(current && heroId && current.characterId === heroId);
    element.classList.toggle('is-my-turn', myTurn);
    setChildren(
      element,
      h(
        'div',
        { class: 'play-combat-head' },
        h('strong', {}, `⚔ Kampf · Runde ${combat.round}`),
        h(
          'span',
          { class: 'play-combat-current', role: 'status' },
          myTurn ? 'Du bist am Zug!' : current ? `Am Zug: ${current.name}` : 'Initiative würfeln …',
        ),
      ),
      combat.entries.length ? orderList(combat, heroId) : null,
      isMaster() ? masterTools(combat) : null,
      !isMaster() && hero && heroId ? playerTools(combat, hero, heroId) : null,
    );
  }

  return { element, render };
}
