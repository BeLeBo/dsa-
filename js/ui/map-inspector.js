/**
 * map-inspector.js – Panel des Meisters unten auf der Karte für die ausgewählten Figuren.
 *  - Eine Heldenfigur: LeP, AsP, KaP und Schicksalspunkte (−/+ oder eintippen) sowie die
 *    Zustände direkt ändern, Heldenbogen öffnen, Figur bearbeiten oder verbergen.
 *  - Eine Gegner-/NSC-Figur: bearbeiten, verbergen.
 *  - Mehrere Figuren: Liste mit LeP der Helden, gemeinsam verbergen/zeigen oder entfernen.
 * Änderungen an Helden laufen über heroActions (mode-room.js) und sind sofort für alle sichtbar.
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { CONDITIONS, MAX_CONDITION_LEVEL, ROMAN_LEVELS } from '../rules.js';
import { describeConditions, heroName } from '../sheet.js';

const POOLS = Object.freeze([
  { key: 'le', label: 'LeP', always: true },
  { key: 'asp', label: 'AsP' },
  { key: 'kap', label: 'KaP' },
  { key: 'schip', label: 'SchiP', always: true },
]);

function stepButton(label, text, onclick, disabled = false) {
  return h('button', { type: 'button', class: 'step-button', 'aria-label': label, onclick, disabled }, text);
}

/**
 * @param {object} options
 * @param {() => object[]} options.selectedTokens          die ausgewählten Figuren (aktueller Stand)
 * @param {(characterId: string) => object|null} options.heroFor  Heldendaten (normalisiert)
 * @param {object} options.heroActions  { adjustPool, setPool, setCondition, open }
 * @param {(token: object) => void} options.onEdit        Figur bearbeiten (Dialog)
 * @param {(ids: string[], hidden: boolean) => void} options.onHide
 * @param {(ids: string[]) => void} options.onRemove
 * @param {() => void} options.onClose                    Auswahl aufheben
 */
export function createMapInspector({ selectedTokens, heroFor, heroActions, onEdit, onHide, onRemove, onClose }) {
  const element = h('section', { class: 'map-inspector', hidden: true, 'aria-label': 'Ausgewählte Figuren' });
  let renderedKey = '';
  let renderedIds = '';
  /** Zustände auf- oder zugeklappt (gilt, bis eine andere Figur ausgewählt wird). */
  let conditionsOpen = null;

  function header(title, subtitle) {
    return h(
      'div',
      { class: 'inspector-header' },
      h(
        'div',
        { class: 'inspector-title' },
        h('strong', {}, title),
        subtitle ? h('span', { class: 'row-sub' }, subtitle) : null,
      ),
      h(
        'button',
        { type: 'button', class: 'icon-button', 'aria-label': 'Auswahl aufheben', onclick: onClose },
        icon(ICONS.close),
      ),
    );
  }

  function poolRow(characterId, hero, { key, label }) {
    const pool = hero.base[key];
    const input = h('input', {
      type: 'number',
      class: 'num',
      inputmode: 'numeric',
      value: String(pool.current),
      'aria-label': `${label} aktuell`,
      onchange: (event) => heroActions.setPool(characterId, key, event.target.value),
    });
    return h(
      'div',
      { class: 'inspector-pool' },
      h('span', { class: 'inspector-label' }, label),
      stepButton(`${label} −1`, '−', () => heroActions.adjustPool(characterId, key, -1)),
      input,
      stepButton(`${label} +1`, '+', () => heroActions.adjustPool(characterId, key, 1)),
      h('span', { class: 'inspector-max' }, `/ ${pool.max}`),
    );
  }

  function conditionRow(characterId, hero, { id, name }) {
    const level = hero.conditions[id];
    return h(
      'div',
      { class: `inspector-condition ${level > 0 ? 'is-active' : ''}`.trim() },
      h('span', {}, name),
      stepButton(`${name} −1`, '−', () => heroActions.setCondition(characterId, id, level - 1), level <= 0),
      h('strong', { class: 'inspector-level' }, ROMAN_LEVELS[level]),
      stepButton(
        `${name} +1`,
        '+',
        () => heroActions.setCondition(characterId, id, level + 1),
        level >= MAX_CONDITION_LEVEL,
      ),
    );
  }

  function heroDetails(token, hero) {
    const active = describeConditions(hero);
    return [
      h(
        'div',
        { class: 'inspector-pools' },
        POOLS.filter((pool) => pool.always || hero.base[pool.key].max > 0).map((pool) =>
          poolRow(token.character_id, hero, pool),
        ),
      ),
      h(
        'details',
        {
          class: 'inspector-conditions',
          open: conditionsOpen ?? Boolean(active),
          ontoggle: (event) => (conditionsOpen = event.target.open),
        },
        h('summary', {}, active ? `Zustände: ${active}` : 'Zustände: keine'),
        h(
          'div',
          { class: 'inspector-condition-grid' },
          CONDITIONS.map((condition) => conditionRow(token.character_id, hero, condition)),
        ),
      ),
    ];
  }

  function actionButtons(tokens) {
    const ids = tokens.map((token) => token.id);
    const allHidden = tokens.every((token) => token.hidden);
    const single = tokens.length === 1 ? tokens[0] : null;
    return h(
      'div',
      { class: 'inspector-actions' },
      single?.character_id && heroFor(single.character_id)
        ? h(
            'button',
            { type: 'button', class: 'btn', onclick: () => heroActions.open(single.character_id) },
            'Heldenbogen',
          )
        : null,
      single ? h('button', { type: 'button', class: 'btn', onclick: () => onEdit(single) }, 'Figur bearbeiten') : null,
      h(
        'button',
        { type: 'button', class: 'btn', onclick: () => onHide(ids, !allHidden) },
        allHidden ? 'Zeigen' : 'Verbergen',
      ),
      tokens.length > 1
        ? h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => onRemove(ids) }, 'Entfernen')
        : null,
    );
  }

  function listRow(token) {
    const hero = token.character_id ? heroFor(token.character_id) : null;
    const pool = hero?.base.le;
    return h(
      'li',
      { class: 'inspector-list-row' },
      h(
        'span',
        { class: 'inspector-list-name' },
        token.name,
        token.hidden ? h('span', { class: 'badge' }, 'verborgen') : null,
      ),
      hero
        ? h(
            'span',
            { class: 'inspector-list-life' },
            stepButton(`${token.name}: LeP −1`, '−', () => heroActions.adjustPool(token.character_id, 'le', -1)),
            h('span', { class: 'inspector-list-value' }, h('small', {}, 'LeP '), `${pool.current}/${pool.max}`),
            stepButton(`${token.name}: LeP +1`, '+', () => heroActions.adjustPool(token.character_id, 'le', 1)),
          )
        : null,
    );
  }

  /** Inhalt als Schlüssel: nur neu aufbauen, wenn sich wirklich etwas geändert hat. */
  function contentKey(tokens) {
    return JSON.stringify(
      tokens.map((token) => {
        const hero = token.character_id ? heroFor(token.character_id) : null;
        return [
          token.id,
          token.name,
          token.hidden,
          token.character_id,
          hero ? [hero.base, hero.conditions, heroName(hero)] : null,
        ];
      }),
    );
  }

  /** Zeigt die ausgewählten Figuren (keine Auswahl blendet das Panel aus). */
  function render() {
    const tokens = selectedTokens();
    element.hidden = tokens.length === 0;
    if (tokens.length === 0) {
      renderedKey = '';
      renderedIds = '';
      return;
    }
    const ids = tokens.map((token) => token.id).join(',');
    const key = contentKey(tokens);
    const typing = element.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (key === renderedKey || (typing && ids === renderedIds)) return; // Eingabe nicht unterbrechen
    if (ids !== renderedIds) conditionsOpen = null;
    renderedKey = key;
    renderedIds = ids;

    if (tokens.length > 1) {
      setChildren(
        element,
        header(`${tokens.length} Figuren ausgewählt`, 'Ziehen bewegt alle gemeinsam'),
        h('ul', { class: 'inspector-list' }, tokens.map(listRow)),
        actionButtons(tokens),
      );
      return;
    }
    const [token] = tokens;
    const hero = token.character_id ? heroFor(token.character_id) : null;
    const subtitle = hero
      ? `Held: ${heroName(hero)}${token.hidden ? ' · verborgen' : ''}`
      : `Gegner/NSC${token.hidden ? ' · verborgen' : ''}`;
    setChildren(element, header(token.name, subtitle), hero ? heroDetails(token, hero) : null, actionButtons(tokens));
  }

  // Nach dem Tippen (Feld verlassen) auf den neuesten Stand bringen.
  element.addEventListener('focusout', () =>
    setTimeout(() => {
      renderedKey = '';
      render();
    }),
  );

  return { element, render };
}
