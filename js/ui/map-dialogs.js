/**
 * map-dialogs.js – Dialoge des Meisters für die Karte: Karten verwalten (hochladen, zeigen,
 * umbenennen, löschen) und Figuren aufstellen oder bearbeiten.
 */
import { h, setChildren } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { showToast, showError } from './toast.js';
import {
  TOKEN_COLORS,
  TOKEN_SIZES,
  MAX_TOKENS_AT_ONCE,
  MAX_TOKEN_LIFE,
  MAX_TOKEN_NAME_LENGTH,
  MAX_MAP_NAME_LENGTH,
  mapNameFromFile,
} from '../map.js';
import { heroName, normalizeHero } from '../sheet.js';

/** Knopf, der während einer Aktion gesperrt ist und „…“ zeigt. */
function busyButton(label, busyLabel, action, className = 'btn') {
  const button = h('button', { type: 'button', class: className }, label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await action();
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
  return button;
}

function field(label, control, hint = '') {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
  );
}

const NO_FILE = 'Kein Bild gewählt';

/** Bildauswahl mit deutschem Knopf (die Beschriftung des Browsers folgt sonst dessen Sprache). */
function imagePicker(label, hint) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'file-input' });
  const fileName = h('span', { class: 'file-name' }, NO_FILE);
  input.addEventListener('change', () => {
    fileName.textContent = input.files[0]?.name ?? NO_FILE;
  });
  const element = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('label', { class: 'file-picker' }, input, h('span', { class: 'btn' }, 'Bild wählen …'), fileName),
    hint ? h('span', { class: 'field-hint' }, hint) : null,
  );
  return { input, element };
}

// ---------------------------------------------------------------------------
// Karten verwalten
// ---------------------------------------------------------------------------

function uploadForm(actions, onDone) {
  const picker = imagePicker('Bild (JPG, PNG oder WebP)', 'Große Bilder werden automatisch verkleinert.');
  const fileInput = picker.input;
  const nameInput = h('input', { type: 'text', name: 'name', maxlength: MAX_MAP_NAME_LENGTH, autocomplete: 'off' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file && !nameInput.value.trim()) nameInput.value = mapNameFromFile(file.name);
  });
  const upload = busyButton(
    'Hochladen',
    'wird hochgeladen …',
    async () => {
      const file = fileInput.files[0];
      if (!file) {
        showToast('Bitte zuerst ein Bild auswählen.');
        return;
      }
      try {
        const map = await actions.uploadMap(file, nameInput.value || mapNameFromFile(file.name));
        onDone(); // erst schließen: Meldungen in einem Dialog verschwinden mit ihm
        showToast(`Karte „${map.name || 'Karte'}“ hochgeladen – nur du siehst sie, bis du sie zeigst.`);
      } catch (error) {
        showError(error, 'Hochladen fehlgeschlagen');
      }
    },
    'btn btn-primary',
  );
  return h(
    'section',
    { class: 'map-upload' },
    h('h3', {}, 'Neue Karte hochladen'),
    picker.element,
    field('Name', nameInput),
    upload,
  );
}

function mapRow(map, { activeMapId, viewMapId }, actions, close) {
  const isActive = map.id === activeMapId;
  const isViewed = map.id === viewMapId;
  const run = (label, action) => async () => {
    try {
      await action();
    } catch (error) {
      showError(error, label);
    }
  };
  return h(
    'li',
    { class: `map-list-row ${isViewed ? 'is-viewed' : ''}`.trim() },
    h(
      'div',
      { class: 'map-list-name' },
      h('strong', {}, map.name || 'Karte ohne Namen'),
      h(
        'span',
        { class: 'row-sub' },
        [isActive ? 'für alle sichtbar' : 'nur für dich', isViewed ? 'wird angezeigt' : null]
          .filter(Boolean)
          .join(' · '),
      ),
    ),
    h(
      'div',
      { class: 'button-row' },
      isViewed
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: run('Öffnen fehlgeschlagen', async () => {
                await actions.openMap(map.id);
                close();
              }),
            },
            'Öffnen',
          ),
      h(
        'button',
        {
          type: 'button',
          class: `btn ${isActive ? '' : 'btn-primary'}`.trim(),
          onclick: run('Zeigen fehlgeschlagen', async () => {
            await actions.showMap(isActive ? null : map.id);
            showToast(isActive ? 'Die Spieler sehen jetzt keine Karte.' : `Alle sehen jetzt „${map.name || 'Karte'}“.`);
          }),
        },
        isActive ? 'Für alle ausblenden' : 'Allen zeigen',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: run('Umbenennen fehlgeschlagen', async () => {
            const name = await promptText('Karte umbenennen', map.name, MAX_MAP_NAME_LENGTH);
            if (name !== null) await actions.renameMap(map.id, name);
          }),
        },
        'Umbenennen',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-danger-outline',
          onclick: run('Löschen fehlgeschlagen', async () => {
            const question = `Karte „${map.name || 'Karte'}“ mit allen Figuren darauf löschen?`;
            if (await confirmDialog(question, { confirmLabel: 'Löschen', danger: true })) {
              await actions.removeMap(map.id);
              showToast('Karte gelöscht.');
            }
          }),
        },
        'Löschen',
      ),
    ),
  );
}

/** Einfache Texteingabe als Dialog. Liefert den Text oder null (abgebrochen). */
function promptText(title, value, maxLength) {
  return new Promise((resolve) => {
    let result = null;
    const dialog = openDialog({ title, className: 'dialog-small', onClose: () => resolve(result) });
    const input = h('input', { type: 'text', value: value ?? '', maxlength: maxLength, autocomplete: 'off' });
    const save = () => {
      result = input.value.trim();
      dialog.close();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
    });
    dialog.body.append(input);
    dialog.footer.append(
      h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Speichern'),
    );
    input.focus();
  });
}

/**
 * Meister: Karten verwalten.
 * @param {object} controller  siehe room-map.js
 */
export function openMapsDialog(controller) {
  let unsubscribe = () => {};
  const dialog = openDialog({ title: 'Karten', onClose: () => unsubscribe() });
  const list = h('ul', { class: 'map-list' });
  let renderedKey = '';
  const render = (state) => {
    // Nur bei geänderten Karten neu aufbauen (nicht bei jeder bewegten Figur).
    const key = JSON.stringify([state.maps.map((map) => [map.id, map.name]), state.activeMapId, state.viewMapId]);
    if (key === renderedKey) return;
    renderedKey = key;
    setChildren(
      list,
      state.maps.length
        ? state.maps.map((map) => mapRow(map, state, controller.actions, dialog.close))
        : h('li', { class: 'empty-hint' }, 'Noch keine Karte hochgeladen.'),
    );
  };
  dialog.body.append(
    h(
      'p',
      { class: 'section-hint' },
      'Neue Karten siehst zuerst nur du – so kannst du sie in Ruhe vorbereiten. „Allen zeigen“ macht sie für die Gruppe sichtbar.',
    ),
    list,
    uploadForm(controller.actions, dialog.close),
  );
  render(controller.state.get());
  unsubscribe = controller.state.subscribe(render);
}

// ---------------------------------------------------------------------------
// Figur aufstellen / bearbeiten
// ---------------------------------------------------------------------------

function colorPicker(value, onChange) {
  const buttons = TOKEN_COLORS.map((color) =>
    h('button', {
      type: 'button',
      class: `swatch ${color.id === value ? 'active' : ''}`.trim(),
      style: `--swatch: ${color.value}`,
      'aria-label': color.name,
      'aria-pressed': String(color.id === value),
      onclick: () => {
        buttons.forEach((button, index) => {
          const active = TOKEN_COLORS[index].id === color.id;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        onChange(color.id);
      },
    }),
  );
  return h('div', { class: 'swatches', role: 'group', 'aria-label': 'Farbe' }, buttons);
}

function heroOptions(characters, selectedId) {
  return [
    h('option', { value: '' }, '– kein Held (Gegner, NSC) –'),
    ...characters.map((character) =>
      h(
        'option',
        { value: character.id, selected: character.id === selectedId },
        heroName(normalizeHero(character.data)),
      ),
    ),
  ];
}

/**
 * Meister: Figur aufstellen (token = null) oder bearbeiten.
 * @param {object} options { controller, token, characters, center() }
 */
export function openTokenDialog({ controller, token = null, characters, center }) {
  const isNew = token === null;
  const dialog = openDialog({ title: isNew ? 'Figur aufstellen' : 'Figur bearbeiten' });
  const values = {
    color: token?.color ?? TOKEN_COLORS[0].id,
    removeImage: false,
  };
  const heroNameOf = (id) => {
    const character = characters.find((entry) => entry.id === id);
    return character ? heroName(normalizeHero(character.data)) : '';
  };

  const nameInput = h('input', {
    type: 'text',
    value: token?.name ?? '',
    maxlength: MAX_TOKEN_NAME_LENGTH,
    placeholder: 'z. B. Ork',
    autocomplete: 'off',
  });
  const heroSelect = h('select', {}, heroOptions(characters, token?.character_id ?? ''));
  const countInput = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    value: '1',
    min: 1,
    max: MAX_TOKENS_AT_ONCE,
  });
  const sizeSelect = h(
    'select',
    {},
    TOKEN_SIZES.map((size) =>
      h('option', { value: String(size.value), selected: size.value === (token?.size ?? 1) }, size.name),
    ),
  );
  const picker = imagePicker(
    isNew || !token.image_path ? 'Bild (optional)' : 'Neues Bild',
    'Wird quadratisch zugeschnitten.',
  );
  const fileInput = picker.input;
  const hiddenInput = h('input', { type: 'checkbox', checked: token?.hidden === true });
  const countField = field('Anzahl', countInput, 'Mehrere werden nummeriert: Ork 1, Ork 2 …');
  const lifeInput = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 0,
    max: MAX_TOKEN_LIFE,
    value: token?.le_max ?? '',
    placeholder: 'z. B. 30',
    'aria-label': 'Lebensenergie (LeP)',
  });
  const lifeField = field(
    'Lebensenergie (LeP)',
    lifeInput,
    isNew ? 'Für Gegner und NSC – jede Figur startet mit vollen LeP. Leer = ohne LeP.' : 'Maximum. Leer = ohne LeP.',
  );

  let previousHeroName = heroNameOf(heroSelect.value);
  heroSelect.addEventListener('change', () => {
    const name = heroNameOf(heroSelect.value);
    if (!nameInput.value.trim() || nameInput.value === previousHeroName) nameInput.value = name;
    previousHeroName = name;
    countField.hidden = !isNew || Boolean(heroSelect.value);
    lifeField.hidden = Boolean(heroSelect.value); // Helden haben ihre LeP im Heldenbogen
  });
  countField.hidden = !isNew || Boolean(heroSelect.value);
  lifeField.hidden = Boolean(heroSelect.value);

  const removeImage =
    !isNew && token.image_path
      ? h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', onchange: (event) => (values.removeImage = event.target.checked) }),
          h('span', {}, 'Bild entfernen (Kürzel statt Bild)'),
        )
      : null;

  setChildren(
    dialog.body,
    field('Name', nameInput),
    characters.length ? field('Gehört zu Held', heroSelect, 'Der Spieler dieses Helden darf die Figur bewegen.') : null,
    isNew ? countField : null,
    lifeField,
    field('Größe', sizeSelect),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Farbe'),
      colorPicker(values.color, (id) => (values.color = id)),
    ),
    picker.element,
    removeImage,
    h(
      'label',
      { class: 'check' },
      hiddenInput,
      h('span', {}, 'Verborgen – nur du siehst die Figur (z. B. Hinterhalt)'),
    ),
  );

  async function save() {
    const spec = {
      name: nameInput.value.trim() || heroNameOf(heroSelect.value),
      characterId: heroSelect.value || null,
      size: Number(sizeSelect.value),
      color: values.color,
      hidden: hiddenInput.checked,
      leMax: heroSelect.value ? undefined : lifeInput.value,
    };
    if (!spec.name) {
      showToast('Bitte einen Namen eingeben.');
      nameInput.focus();
      return;
    }
    try {
      if (isNew) {
        const created = await controller.actions.addTokens(
          { ...spec, count: spec.characterId ? 1 : countInput.value, imageFile: fileInput.files[0] ?? null },
          center(),
        );
        dialog.close(); // erst schließen: Meldungen in einem Dialog verschwinden mit ihm
        showToast(created.length > 1 ? `${created.length} Figuren aufgestellt.` : `„${created[0].name}“ aufgestellt.`);
      } else {
        await controller.actions.editToken(token.id, spec, {
          file: fileInput.files[0] ?? null,
          remove: values.removeImage,
        });
        dialog.close();
      }
    } catch (error) {
      showError(error, 'Figur nicht gespeichert');
    }
  }

  setChildren(
    dialog.footer,
    isNew
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'btn btn-danger-outline',
            onclick: async () => {
              if (
                !(await confirmDialog(`„${token.name}“ von der Karte nehmen?`, {
                  confirmLabel: 'Entfernen',
                  danger: true,
                }))
              ) {
                return;
              }
              try {
                await controller.actions.removeToken(token.id);
                dialog.close();
              } catch (error) {
                showError(error, 'Figur nicht entfernt');
              }
            },
          },
          'Entfernen',
        ),
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
    busyButton(isNew ? 'Aufstellen' : 'Speichern', 'speichert …', save, 'btn btn-primary'),
  );
  if (isNew) nameInput.focus();
}

// ---------------------------------------------------------------------------
// Spieler: eigene Figur aufstellen
// ---------------------------------------------------------------------------

/**
 * Spieler: die Figur des eigenen Helden auf die gezeigte Karte stellen – Farbe und (optional)
 * ein Bild. Name und LeP kommen aus dem Heldenbogen.
 * @param {object} options { controller, heroName, center: () => {x, y} }
 */
export function openOwnTokenDialog({ controller, heroName: name, center }) {
  const dialog = openDialog({ title: 'Meine Figur aufstellen' });
  const values = { color: 'blau' };
  const picker = imagePicker(
    'Bild (optional)',
    'Wird quadratisch zugeschnitten. Ohne Bild: das Bild deiner letzten Figur bzw. deine Initialen.',
  );
  setChildren(
    dialog.body,
    h('p', {}, `„${name}“ kommt auf ein freies Feld in der Mitte deines Ausschnitts. Danach kannst du sie ziehen.`),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Farbe'),
      colorPicker(values.color, (id) => (values.color = id)),
    ),
    picker.element,
  );
  const submit = h('button', { type: 'button', class: 'btn btn-primary' }, 'Aufstellen');
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    try {
      await controller.actions.placeOwnToken(
        { color: values.color, imageFile: picker.input.files[0] ?? null },
        center(),
      );
      dialog.close(); // erst schließen: Meldungen in einem Dialog verschwinden mit ihm
      showToast(`„${name}“ steht auf der Karte.`);
    } catch (error) {
      showError(error, 'Figur nicht aufgestellt');
      submit.disabled = false;
    }
  });
  setChildren(
    dialog.footer,
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
    submit,
  );
}
