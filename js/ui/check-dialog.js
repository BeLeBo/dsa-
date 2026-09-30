/**
 * check-dialog.js – Probendialog: Modifikator wählen, würfeln, Ergebnis zeigen,
 * Schicksalspunkt einsetzen, Zauber-/Liturgiekosten abziehen (mit Rückgängig).
 */
import { h, setChildren } from './dom.js';
import { openDialog } from './dialog.js';
import { renderRollDetails } from './roll-view.js';
import { ATTRIBUTE_NAMES, SPECIAL, SPECIALIZATION_BONUS, parseCost, costToPay, toInt } from '../rules.js';
import { RESOURCE_NAMES } from '../data/talents.js';
import {
  attributeValue,
  describeCheck,
  describeConditions,
  dodgeOf,
  initiativeBaseOf,
  techniqueInfo,
  techniqueValues,
  talentInfo,
  weaponValues,
  spellTypeInfo,
  conditionState,
  payEnergy,
  refundEnergy,
  spendFatePoint,
} from '../sheet.js';
import {
  ROLL_TYPES,
  rollSkill,
  rollD20,
  rollDamage,
  rollInitiative,
  fateRerollBlocker,
  rerollWithFate,
  isCheckRecord,
} from '../checks.js';
import { formatModifier } from '../format.js';

const VALUE_LABELS = { at: 'Attacke', pa: 'Parade', fk: 'Fernkampf' };

const QUICK_MODIFIERS = [-5, -3, -2, -1, 0, 1, 2, 3, 5];

function findById(list, id, what) {
  const entry = list.find((item) => item.id === id);
  if (!entry) throw new Error(`${what} ist nicht mehr im Heldenbogen vorhanden.`);
  return entry;
}

/**
 * Wandelt eine Probenbeschreibung (siehe roll-actions.js) in alles, was der Dialog braucht.
 * Werte werden bei jedem Aufruf frisch aus dem Helden gelesen.
 */
function resolveCheck(hero, spec) {
  switch (spec.kind) {
    case 'attribute':
      return {
        kind: 'd20',
        type: ROLL_TYPES.ATTRIBUTE,
        label: `${ATTRIBUTE_NAMES[spec.code]} (${spec.code})`,
        target: attributeValue(hero, spec.code),
        subtitle: `Eigenschaftsprobe auf ${attributeValue(hero, spec.code)}`,
      };
    case 'talent': {
      const talent = findById(hero.talents, spec.id, 'Das Talent');
      return {
        kind: 'skill',
        label: talentInfo(talent.id).name,
        entry: talent,
        subtitle: `${describeCheck(hero, talent.check)} · FW ${talent.fw}`,
      };
    }
    case 'spell': {
      const spell = findById(hero.spells, spec.id, 'Der Zauber');
      const type = spellTypeInfo(spell.type);
      return {
        kind: 'skill',
        label: spell.name || type.name,
        entry: spell,
        subtitle: `${type.name} · ${describeCheck(hero, spell.check)} · FW ${spell.fw}`,
        cost: { resource: type.resource, amount: parseCost(spell.cost) },
      };
    }
    case 'dodge':
      return {
        kind: 'd20',
        type: ROLL_TYPES.COMBAT,
        label: 'Ausweichen',
        target: dodgeOf(hero),
        subtitle: `AW ${dodgeOf(hero)}`,
      };
    case 'technique': {
      const entry = findById(hero.combatTechniques, spec.id, 'Die Kampftechnik');
      const target = techniqueValues(hero, entry)[spec.value];
      return {
        kind: 'd20',
        type: ROLL_TYPES.COMBAT,
        label: `${VALUE_LABELS[spec.value]} ${techniqueInfo(entry.id).name}`,
        target,
        subtitle: `${spec.value.toUpperCase()} ${target}`,
      };
    }
    case 'weapon': {
      const weapon = findById(hero.weapons, spec.id, 'Die Waffe');
      const target = weaponValues(hero, weapon)[spec.value];
      return {
        kind: 'd20',
        type: ROLL_TYPES.COMBAT,
        label: `${VALUE_LABELS[spec.value]} ${weapon.name || 'Waffe'}`,
        target,
        weapon,
        attack: spec.value !== 'pa',
        subtitle: `${spec.value.toUpperCase()} ${target} · TP ${weapon.tp}`,
      };
    }
    case 'initiative':
      return { kind: 'initiative', label: 'Initiative', subtitle: `INI ${initiativeBaseOf(hero)} + 1W6` };
    case 'damage': {
      const weapon = findById(hero.weapons, spec.id, 'Die Waffe');
      return { kind: 'damage', label: `Schaden ${weapon.name || 'Waffe'}`, weapon, subtitle: `TP ${weapon.tp}` };
    }
    default:
      throw new Error(`Unbekannte Probe „${spec.kind}“.`);
  }
}

/**
 * Öffnet den Probendialog.
 * @param {object} deps { store, log }
 * @param {object} spec Probenbeschreibung, z. B. { kind: 'talent', id: 'klettern' }
 */
export function openCheckDialog({ store, log }, spec) {
  const initial = resolveCheck(store.hero, spec);
  const state = {
    modifier: 0,
    includeConditions: true,
    useSpecialization: false,
    double: spec.double === true,
    payCost: initial.cost?.amount != null,
    costAmount: initial.cost?.amount ?? 0,
    record: null,
    payment: null,
    selecting: false,
    selected: new Set(),
    error: null,
  };
  const dialog = openDialog({ title: initial.label, className: 'check-dialog' });

  // -------------------------------------------------------------------------
  // Einstellungen vor dem Wurf
  // -------------------------------------------------------------------------

  function modifierControl() {
    const value = h('output', { class: 'modifier-value' }, formatModifier(state.modifier));
    const set = (next) => {
      state.modifier = Math.max(-20, Math.min(20, next));
      renderSetup();
    };
    return h(
      'div',
      { class: 'modifier' },
      h('span', { class: 'field-label' }, 'Erleichterung (+) / Erschwernis (−)'),
      h(
        'div',
        { class: 'modifier-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'step-button',
            'aria-label': 'Erschwernis erhöhen',
            onclick: () => set(state.modifier - 1),
          },
          '−',
        ),
        value,
        h(
          'button',
          {
            type: 'button',
            class: 'step-button',
            'aria-label': 'Erleichterung erhöhen',
            onclick: () => set(state.modifier + 1),
          },
          '+',
        ),
      ),
      h(
        'div',
        { class: 'chips' },
        QUICK_MODIFIERS.map((mod) =>
          h(
            'button',
            { type: 'button', class: `chip ${mod === state.modifier ? 'active' : ''}`, onclick: () => set(mod) },
            formatModifier(mod),
          ),
        ),
      ),
    );
  }

  function toggle(label, key) {
    return h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: state[key],
        onchange: (event) => {
          state[key] = event.target.checked;
          renderSetup();
        },
      }),
      h('span', {}, label),
    );
  }

  function conditionsControl(hero) {
    const { penalty } = conditionState(hero);
    const description = describeConditions(hero);
    if (!description) return null;
    return toggle(`Zustände einrechnen: ${formatModifier(penalty)} (${description})`, 'includeConditions');
  }

  function costControl(hero, check) {
    const resourceName = RESOURCE_NAMES[check.cost.resource];
    const available = hero.base[check.cost.resource].current;
    return h(
      'div',
      { class: 'cost' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, `Kosten in ${resourceName} (vorhanden: ${available})`),
        h('input', {
          type: 'number',
          inputmode: 'numeric',
          class: 'num',
          value: String(state.costAmount),
          oninput: (event) => {
            state.costAmount = Math.max(0, toInt(event.target.value));
          },
        }),
      ),
      toggle(`Nach der Probe von ${resourceName} abziehen (misslungen: halbe Kosten)`, 'payCost'),
    );
  }

  function totalModifierLine(hero, check) {
    if (check.kind === 'damage') return null;
    const conditions = check.kind !== 'initiative' && state.includeConditions ? conditionState(hero).penalty : 0;
    return h('p', { class: 'readout' }, `Gesamtmodifikator: ${formatModifier(state.modifier + conditions)}`);
  }

  function renderSetup() {
    const hero = store.hero;
    let check;
    try {
      check = resolveCheck(hero, spec);
    } catch (error) {
      setChildren(dialog.body, h('p', { class: 'error-text' }, error.message));
      setChildren(
        dialog.footer,
        h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Schließen'),
      );
      return;
    }
    const hasSpecialization = check.kind === 'skill' && check.entry.spec;
    setChildren(
      dialog.body,
      h('p', { class: 'dialog-subtitle' }, check.subtitle),
      check.kind === 'damage' ? null : modifierControl(),
      check.kind === 'skill' || check.kind === 'd20' ? conditionsControl(hero) : null,
      hasSpecialization
        ? toggle(`Spezialisierung „${check.entry.spec}“ nutzen (FW +${SPECIALIZATION_BONUS})`, 'useSpecialization')
        : null,
      check.cost ? costControl(hero, check) : null,
      check.kind === 'damage' ? toggle('Kritischer Treffer: Schaden verdoppeln', 'double') : null,
      totalModifierLine(hero, check),
      state.error ? h('p', { class: 'error-text' }, state.error) : null,
    );
    setChildren(
      dialog.footer,
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: roll }, 'Würfeln'),
    );
  }

  // -------------------------------------------------------------------------
  // Würfeln
  // -------------------------------------------------------------------------

  function performRoll(hero, check) {
    const common = { label: check.label, modifier: state.modifier, includeConditions: state.includeConditions };
    switch (check.kind) {
      case 'skill':
        return rollSkill(hero, check.entry, { ...common, useSpecialization: state.useSpecialization });
      case 'd20':
        return rollD20(hero, { ...common, type: check.type, target: check.target, weaponId: check.weapon?.id ?? null });
      case 'initiative':
        return rollInitiative(hero, { modifier: state.modifier });
      default:
        return rollDamage(hero, check.weapon, { double: state.double });
    }
  }

  /**
   * Bucht Kosten passend zum Ergebnis; ein früherer Abzug (vor einem Neuwurf) wird vorher erstattet.
   * Wurden die Kosten bewusst zurückgebucht, bleibt es dabei.
   */
  function settleCost(hero, check, record) {
    if (state.payment?.undone) return;
    if (state.payment) refundEnergy(hero, state.payment.resource, state.payment.paid);
    state.payment = null;
    if (!check.cost || !state.payCost) return;
    const requested = costToPay(state.costAmount, record.result.success);
    const paid = payEnergy(hero, check.cost.resource, requested);
    state.payment = { resource: check.cost.resource, requested, paid, undone: false };
  }

  function roll() {
    const hero = store.hero;
    try {
      const check = resolveCheck(hero, spec);
      const record = performRoll(hero, check);
      log.add(record);
      state.record = record;
      state.error = null;
      settleCost(hero, check, record);
      store.changed('value', null);
      renderResult();
    } catch (error) {
      state.error = error.message;
      renderSetup();
    }
  }

  // -------------------------------------------------------------------------
  // Ergebnis
  // -------------------------------------------------------------------------

  function paymentInfo() {
    const payment = state.payment;
    if (!payment) return null;
    const name = RESOURCE_NAMES[payment.resource];
    if (payment.undone) return h('p', { class: 'roll-note' }, `${payment.paid} ${name} zurückgebucht.`);
    const shortfall =
      payment.paid < payment.requested ? ` (nur ${payment.paid} von ${payment.requested} vorhanden)` : '';
    return h(
      'div',
      { class: 'payment' },
      h(
        'span',
        {},
        `−${payment.paid} ${name} abgezogen${shortfall}, jetzt ${store.hero.base[payment.resource].current}`,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          onclick: () => {
            refundEnergy(store.hero, payment.resource, payment.paid);
            payment.undone = true;
            store.changed('value', null);
            renderResult();
          },
        },
        'Rückgängig',
      ),
    );
  }

  function rerollWithFatePoint(indices) {
    const hero = store.hero;
    try {
      const next = rerollWithFate(state.record, indices); // prüft vorher, ob ein Neuwurf erlaubt ist
      if (!spendFatePoint(hero)) throw new Error('Keine Schicksalspunkte mehr übrig.');
      log.add(next);
      state.record = next;
      state.selecting = false;
      state.selected.clear();
      settleCost(hero, resolveCheck(hero, spec), next);
      store.changed('value', null);
    } catch (error) {
      state.error = error.message;
    }
    renderResult();
  }

  function fateControls() {
    const record = state.record;
    const blocker = fateRerollBlocker(record);
    const fatePoints = store.hero.base.schip.current;
    if (blocker) return isCheckRecord(record) ? h('p', { class: 'roll-note' }, blocker) : null;
    if (fatePoints <= 0) return h('p', { class: 'roll-note' }, 'Keine Schicksalspunkte mehr übrig.');

    if (record.type !== ROLL_TYPES.SKILL) {
      return h(
        'button',
        { type: 'button', class: 'btn', onclick: () => rerollWithFatePoint([0]) },
        `Schicksalspunkt: neu würfeln (${fatePoints} übrig)`,
      );
    }
    if (!state.selecting) {
      return h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            state.selecting = true;
            renderResult();
          },
        },
        `Schicksalspunkt einsetzen (${fatePoints} übrig)`,
      );
    }
    return h(
      'div',
      { class: 'fate-select' },
      h(
        'p',
        { class: 'roll-note' },
        'Tippe die Würfel an, die neu geworfen werden sollen. Das neue Ergebnis ist bindend.',
      ),
      h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              state.selecting = false;
              state.selected.clear();
              renderResult();
            },
          },
          'Abbrechen',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            disabled: state.selected.size === 0,
            onclick: () => rerollWithFatePoint([...state.selected].sort()),
          },
          `Neu werfen (${state.selected.size})`,
        ),
      ),
    );
  }

  function damageButton() {
    const record = state.record;
    const check = resolveCheck(store.hero, spec);
    if (!check.attack || !record.result.success) return null;
    const critical = record.result.special === SPECIAL.CRITICAL;
    return h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary',
        onclick: () => {
          dialog.close();
          openCheckDialog({ store, log }, { kind: 'damage', id: check.weapon.id, double: critical });
        },
      },
      critical ? 'Schaden würfeln (kritisch: ×2)' : 'Schaden würfeln',
    );
  }

  function renderResult() {
    const selection = state.selecting
      ? {
          selected: state.selected,
          onToggle: (index) => {
            if (state.selected.has(index)) state.selected.delete(index);
            else state.selected.add(index);
            renderResult();
          },
        }
      : null;
    let extra = null;
    try {
      extra = [paymentInfo(), fateControls(), damageButton()];
    } catch (error) {
      state.error = error.message;
    }
    setChildren(
      dialog.body,
      h('p', { class: 'dialog-subtitle' }, initial.subtitle),
      renderRollDetails(state.record, selection),
      extra,
      state.error ? h('p', { class: 'error-text' }, state.error) : null,
    );
    setChildren(
      dialog.footer,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            state.record = null;
            state.payment = null;
            state.error = null;
            state.selecting = false;
            state.selected.clear();
            renderSetup();
          },
        },
        'Neue Probe',
      ),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Fertig'),
    );
  }

  renderSetup();
  return dialog;
}
