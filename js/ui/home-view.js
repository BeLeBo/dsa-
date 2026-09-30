/**
 * home-view.js – Startseite: Raum beitreten, Raum erstellen (als Meister) oder ohne Raum spielen.
 */
import { h, setChildren } from './dom.js';
import { MIN_PIN_LENGTH, ROOM_CODE_LENGTH } from '../room.js';

function textField(label, { name, value = '', type = 'text', placeholder = '', autocomplete = 'off', maxlength }) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('input', { type, name, value, placeholder, autocomplete, maxlength, autocapitalize: 'off' }),
  );
}

/**
 * Formular mit Fehleranzeige und „bitte warten“-Zustand.
 * onSubmit(werte) liefert ein Promise; Fehler werden unter dem Formular angezeigt.
 */
function actionForm({ title, intro, fields, submitLabel, busyLabel, onSubmit, extra = null }) {
  const error = h('p', { class: 'error-text', hidden: true, role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, submitLabel);
  const form = h(
    'form',
    {
      class: 'card home-card',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        values.asMaster = form.querySelector('[name="asMaster"]')?.checked === true;
        error.hidden = true;
        submit.disabled = true;
        submit.textContent = busyLabel;
        try {
          await onSubmit(values);
        } catch (problem) {
          error.textContent = problem.message;
          error.hidden = false;
        } finally {
          submit.disabled = false;
          submit.textContent = submitLabel;
        }
      },
    },
    h('h2', {}, title),
    intro ? h('p', { class: 'section-hint' }, intro) : null,
    fields,
    extra,
    error,
    submit,
  );
  return form;
}

function joinForm({ prefillCode, lastName, onJoin }) {
  const pinField = textField('Meister-PIN', { name: 'pin', type: 'password', autocomplete: 'current-password' });
  pinField.hidden = true;
  const masterToggle = h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      name: 'asMaster',
      onchange: (event) => {
        pinField.hidden = !event.target.checked;
      },
    }),
    h('span', {}, 'Ich bin Meister (PIN nötig)'),
  );
  return actionForm({
    title: 'Raum beitreten',
    intro: 'Den Raumcode bekommst du vom Meister.',
    fields: h(
      'div',
      { class: 'stack' },
      textField('Raumcode', {
        name: 'code',
        value: prefillCode,
        placeholder: 'z. B. K7MPQ2',
        maxlength: ROOM_CODE_LENGTH + 2,
      }),
      textField('Dein Name', { name: 'displayName', value: lastName, placeholder: 'z. B. Alrik', maxlength: 40 }),
      masterToggle,
      pinField,
    ),
    submitLabel: 'Beitreten',
    busyLabel: 'Verbinde …',
    onSubmit: onJoin,
  });
}

function createForm({ lastName, onCreate }) {
  return actionForm({
    title: 'Neuen Raum erstellen',
    intro: `Du wirst Meister. Mit der Meister-PIN (mindestens ${MIN_PIN_LENGTH} Zeichen) kannst du später auch von anderen Geräten als Meister beitreten.`,
    fields: h(
      'div',
      { class: 'stack' },
      textField('Name des Raums (optional)', { name: 'roomName', placeholder: 'z. B. Borbarads Erben', maxlength: 60 }),
      textField('Dein Name', {
        name: 'displayName',
        value: lastName,
        placeholder: 'z. B. Meisterin Rahja',
        maxlength: 40,
      }),
      textField('Meister-PIN', { name: 'pin', type: 'password', autocomplete: 'new-password' }),
      textField('PIN wiederholen', { name: 'pinRepeat', type: 'password', autocomplete: 'new-password' }),
    ),
    submitLabel: 'Raum erstellen',
    busyLabel: 'Erstelle Raum …',
    onSubmit: onCreate,
  });
}

/**
 * Zeigt die Startseite.
 * @param {HTMLElement} root
 * @param {object} options
 * @param {boolean} options.configured  Ist ein Supabase-Server eingetragen?
 * @param {string}  options.prefillCode Raumcode aus einem Einladungslink
 * @param {string}  options.lastName    zuletzt benutzter Name
 * @param {string}  [options.message]   Hinweis (z. B. warum man hier gelandet ist)
 * @param {Function} options.onJoin     ({ code, displayName, asMaster, pin }) => Promise
 * @param {Function} options.onCreate   ({ roomName, displayName, pin, pinRepeat }) => Promise
 * @param {Function} options.onLocal    () => void
 */
export function renderHome(
  root,
  { configured, prefillCode = '', lastName = '', message = '', onJoin, onCreate, onLocal },
) {
  document.title = 'DSA5 am Spieltisch';
  const serverCards = configured
    ? [joinForm({ prefillCode, lastName, onJoin }), createForm({ lastName, onCreate })]
    : [
        h(
          'section',
          { class: 'card home-card' },
          h('h2', {}, 'Server noch nicht eingerichtet'),
          h(
            'p',
            {},
            'Für gemeinsames Spielen in Räumen muss einmalig ein Supabase-Projekt eingetragen werden (js/config.js, Anleitung in der README). Ohne Raum kannst du sofort loslegen.',
          ),
        ),
      ];

  setChildren(
    root,
    h(
      'main',
      { class: 'home' },
      h(
        'header',
        { class: 'home-header' },
        h('h1', {}, 'DSA5 am Spieltisch'),
        h('p', {}, 'Heldenbogen, Proben und Würfel für eure Gruppe – am Handy und am Tisch.'),
      ),
      message ? h('p', { class: 'home-message', role: 'status' }, message) : null,
      serverCards,
      h(
        'section',
        { class: 'card home-card' },
        h('h2', {}, 'Ohne Raum spielen'),
        h(
          'p',
          { class: 'section-hint' },
          'Dein Held wird nur auf diesem Gerät gespeichert. Einem Raum kannst du später beitreten.',
        ),
        h('button', { type: 'button', class: 'btn btn-large', onclick: onLocal }, 'Ohne Raum weiter'),
      ),
    ),
  );
}
