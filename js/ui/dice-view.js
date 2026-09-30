/**
 * dice-view.js – Tab „Würfeln“: freie Würfelausdrücke und Schnellzugriff auf häufige Proben.
 */
import { h, setChildren } from './dom.js';
import { renderRollDetails } from './roll-view.js';
import { handleRollClick } from './roll-actions.js';
import { refreshDerived } from './sheet/derived.js';
import { actionButton, derived } from './sheet/parts.js';
import { rollFree } from '../checks.js';
import { techniqueInfo } from '../sheet.js';
import { ATTRIBUTES } from '../rules.js';

const QUICK_EXPRESSIONS = ['1W20', '3W20', '1W6', '2W6', '3W6', '1W3'];

/**
 * @param {HTMLElement} root
 * @param {object} deps { store, log, openCheck, actorName() → Name für freie Würfe }
 */
export function createDiceView(root, { store, log, openCheck, actorName }) {
  const state = { expression: '', lastRecord: null, error: null };
  const resultArea = h('div', { class: 'free-result', 'aria-live': 'polite' });
  const quickArea = h('div', { class: 'quick-checks' });

  function showResult() {
    setChildren(
      resultArea,
      state.error ? h('p', { class: 'error-text' }, state.error) : null,
      state.lastRecord && !state.error ? renderRollDetails(state.lastRecord) : null,
    );
  }

  function rollExpressionText(text) {
    try {
      const record = rollFree(actorName(), text);
      log.add(record);
      state.lastRecord = record;
      state.error = null;
    } catch (error) {
      state.error = error.message;
    }
    showResult();
  }

  const input = h('input', {
    type: 'text',
    class: 'expression-input',
    placeholder: 'z. B. 2W6+3',
    autocomplete: 'off',
    autocapitalize: 'characters',
    'aria-label': 'Würfelausdruck',
    oninput: (event) => {
      state.expression = event.target.value;
    },
  });

  const form = h(
    'form',
    {
      class: 'expression-form',
      onsubmit: (event) => {
        event.preventDefault();
        rollExpressionText(state.expression);
      },
    },
    input,
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Würfeln'),
  );

  const quickDice = h(
    'div',
    { class: 'chips' },
    QUICK_EXPRESSIONS.map((expression) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip chip-wide',
          onclick: () => {
            input.value = expression;
            state.expression = expression;
            rollExpressionText(expression);
          },
        },
        expression,
      ),
    ),
  );

  function renderQuickChecks() {
    const hero = store.hero;
    quickCard.hidden = !hero;
    if (!hero) return;
    const weapons = hero.weapons.map((weapon) => {
      const ranged = techniqueInfo(weapon.technique).ranged;
      const keys = ranged ? ['fk'] : ['at', 'pa'];
      return h(
        'div',
        { class: 'quick-weapon' },
        derived('weapon-name', weapon.id, { className: 'quick-weapon-name' }),
        h(
          'div',
          { class: 'chips' },
          keys.map((key) =>
            actionButton(
              'roll-weapon',
              `${weapon.id}|${key}`,
              [h('small', {}, key.toUpperCase()), derived('weapon-value', `${weapon.id}|${key}`)],
              {
                className: 'chip',
              },
            ),
          ),
          actionButton('roll-damage', weapon.id, [h('small', {}, 'TP'), derived('weapon-tp', weapon.id)], {
            className: 'chip chip-wide',
          }),
        ),
      );
    });
    setChildren(
      quickArea,
      h('h3', {}, 'Eigenschaftsproben'),
      h(
        'div',
        { class: 'chips' },
        ATTRIBUTES.map((code) =>
          actionButton('roll-attribute', code, [h('small', {}, code), String(hero.attributes[code])], {
            className: 'chip',
          }),
        ),
      ),
      h('h3', {}, 'Kampf'),
      h(
        'div',
        { class: 'chips' },
        actionButton('roll-dodge', '', [h('small', {}, 'AW'), derived('dodge')], { className: 'chip' }),
        actionButton('roll-initiative', '', [h('small', {}, 'INI'), derived('ini-base')], { className: 'chip' }),
      ),
      weapons,
    );
    refreshDerived(quickArea, hero);
  }

  const quickCard = h('section', { class: 'card' }, h('h2', {}, 'Schnellzugriff'), quickArea);
  setChildren(
    root,
    h('section', { class: 'card' }, h('h2', {}, 'Freier Wurf'), form, quickDice, resultArea),
    quickCard,
  );
  root.addEventListener('click', (event) => handleRollClick(event, root, openCheck));

  store.subscribe(() => renderQuickChecks());
  renderQuickChecks();
}
