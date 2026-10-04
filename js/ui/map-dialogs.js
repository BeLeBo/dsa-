/**
 * map-dialogs.js – Dialoge des Meisters für die Karte: Karten verwalten (hochladen, selbst bauen,
 * zeigen, umbenennen, löschen) und Figuren aufstellen oder bearbeiten – auch aus gespeicherten Figuren.
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { showToast, showError } from './toast.js';
import {
  TOKEN_COLORS,
  TOKEN_SIZES,
  MAX_TOKENS_AT_ONCE,
  MAX_TOKEN_LIFE,
  MAX_TOKEN_NAME_LENGTH,
  MAX_MAP_NAME_LENGTH,
  MAX_INI_BASE,
  mapNameFromFile,
  initials,
  baseTokenName,
  parseIniBase,
} from '../map.js';
import { heroName, normalizeHero } from '../sheet.js';
import { imageUrl } from '../map-api.js';
import { enemyGroup, rememberedIni, rememberIni } from './play-combat.js';
import { openMapEditor } from './map-editor-view.js';

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

/** Karten-Editor: eigene Karte aus fertigen Objekten bauen oder automatisch erstellen lassen. */
function buildSection(onBuild) {
  return h(
    'section',
    { class: 'map-upload' },
    h('h3', {}, 'Karte selbst bauen'),
    h(
      'p',
      { class: 'section-hint' },
      'Mit fertigen Objekten wie Bäumen, Hütten und Felsen – oder automatisch erstellt (Wald, Dorf, Lager, Fluss, Höhle).',
    ),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: onBuild }, 'Karten-Editor öffnen'),
  );
}

function mapRow(map, { activeMapId, viewMapId }, actions, close, edit) {
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
      map.has_scene
        ? h(
            'button',
            { type: 'button', class: 'btn', onclick: run('Bearbeiten fehlgeschlagen', () => edit(map)) },
            'Bearbeiten',
          )
        : null,
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
    const key = JSON.stringify([
      state.maps.map((map) => [map.id, map.name, map.has_scene]),
      state.activeMapId,
      state.viewMapId,
    ]);
    if (key === renderedKey) return;
    renderedKey = key;
    setChildren(
      list,
      state.maps.length
        ? state.maps.map((map) => mapRow(map, state, controller.actions, dialog.close, edit))
        : h('li', { class: 'empty-hint' }, 'Noch keine Karte hochgeladen.'),
    );
  };
  /** Editor öffnen: Kartenliste schließen, damit nach dem Speichern die Karte zu sehen ist. */
  const edit = async (map) => {
    dialog.close();
    await openMapEditor({ controller, map });
  };
  dialog.body.append(
    h(
      'p',
      { class: 'section-hint' },
      'Neue Karten siehst zuerst nur du – so kannst du sie in Ruhe vorbereiten. „Allen zeigen“ macht sie für die Gruppe sichtbar.',
    ),
    list,
    uploadForm(controller.actions, dialog.close),
    buildSection(() => edit(null)),
  );
  render(controller.state.get());
  unsubscribe = controller.state.subscribe(render);
}

// ---------------------------------------------------------------------------
// Figur aufstellen / bearbeiten
// ---------------------------------------------------------------------------

/** Farbauswahl; select(id) setzt die Farbe von außen (z. B. aus einer gespeicherten Figur). */
function colorPicker(value, onChange) {
  function select(id) {
    buttons.forEach((button, index) => {
      const active = TOKEN_COLORS[index].id === id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    onChange(id);
  }
  const buttons = TOKEN_COLORS.map((color) =>
    h('button', {
      type: 'button',
      class: `swatch ${color.id === value ? 'active' : ''}`.trim(),
      style: `--swatch: ${color.value}`,
      'aria-label': color.name,
      'aria-pressed': String(color.id === value),
      onclick: () => select(color.id),
    }),
  );
  return { element: h('div', { class: 'swatches', role: 'group', 'aria-label': 'Farbe' }, buttons), select };
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

/** Kleines Bild einer gespeicherten Figur (sonst Kürzel in ihrer Farbe). */
function templateFace(template) {
  const color = TOKEN_COLORS.find((entry) => entry.id === template.color) ?? TOKEN_COLORS[0];
  const face = h('span', { class: 'figure-template-face', style: `--swatch: ${color.value}` }, initials(template.name));
  if (template.image_path) {
    imageUrl(template.image_path)
      .then((url) => face.replaceChildren(h('img', { src: url, alt: '' })))
      .catch(() => {}); // Kürzel bleibt
  }
  return face;
}

function templateDetails(template) {
  return [
    template.le_max !== null ? `LeP ${template.le_max}` : null,
    template.ini_base !== null ? `INI ${template.ini_base}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Gespeicherte Figur nach Rückfrage löschen. @returns {Promise<boolean>} gelöscht? */
async function removeTemplateAfterConfirm(controller, template) {
  if (
    !(await confirmDialog(`Gespeicherte Figur „${template.name}“ löschen?`, { confirmLabel: 'Löschen', danger: true }))
  )
    return false;
  try {
    await controller.actions.removeTemplate(template.id);
    return true;
  } catch (error) {
    showError(error, 'Nicht gelöscht');
    return false;
  }
}

/**
 * Meister: gespeicherte Figur bearbeiten – Name (auch umbenennen), LeP, INI-Basis, Größe, Farbe,
 * Bild. Figuren, die schon auf einer Karte stehen, bleiben, wie sie sind.
 * @param {object} options
 * @param {object} options.controller
 * @param {object} options.template
 * @param {(saved: object|null, previous: object) => void} options.onChange  gespeichert (null = gelöscht)
 */
function openTemplateDialog({ controller, template, onChange }) {
  const dialog = openDialog({ title: 'Gespeicherte Figur bearbeiten' });
  const values = { color: template.color, removeImage: false };
  const nameInput = h('input', {
    type: 'text',
    value: template.name,
    maxlength: MAX_TOKEN_NAME_LENGTH,
    autocomplete: 'off',
  });
  const lifeInput = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 0,
    max: MAX_TOKEN_LIFE,
    value: template.le_max ?? '',
    placeholder: 'z. B. 30',
    'aria-label': 'Lebensenergie (LeP)',
  });
  const iniInput = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 0,
    max: MAX_INI_BASE,
    value: template.ini_base ?? '',
    placeholder: 'z. B. 12',
    'aria-label': 'INI-Basis',
  });
  const sizeSelect = h(
    'select',
    {},
    TOKEN_SIZES.map((size) =>
      h('option', { value: String(size.value), selected: size.value === template.size }, size.name),
    ),
  );
  const colors = colorPicker(values.color, (id) => (values.color = id));
  const picker = imagePicker(template.image_path ? 'Neues Bild' : 'Bild (optional)', 'Wird quadratisch zugeschnitten.');

  setChildren(
    dialog.body,
    h(
      'div',
      { class: 'figure-template-image' },
      templateFace(template),
      h('span', {}, 'Figuren, die schon auf einer Karte stehen, bleiben, wie sie sind.'),
    ),
    field('Name', nameInput),
    field('Lebensenergie (LeP)', lifeInput, 'Jede neue Figur startet mit vollen LeP. Leer = ohne LeP.'),
    field('INI-Basis (Kampf)', iniInput, 'Steht im Kampf bei „+ Gegner“ schon drin. Leer = später.'),
    field('Größe', sizeSelect),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbe'), colors.element),
    picker.element,
    template.image_path
      ? h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', onchange: (event) => (values.removeImage = event.target.checked) }),
          h('span', {}, 'Bild entfernen (Kürzel statt Bild)'),
        )
      : null,
  );

  async function save() {
    try {
      const saved = await controller.actions.editTemplate(template.id, {
        name: nameInput.value,
        color: values.color,
        size: sizeSelect.value,
        leMax: lifeInput.value,
        iniBase: iniInput.value,
        imageFile: picker.input.files[0] ?? null,
        removeImage: values.removeImage,
      });
      dialog.close();
      onChange(saved, template);
      showToast(`„${saved.name}“ gespeichert.`);
    } catch (error) {
      showError(error, 'Nicht gespeichert');
    }
  }

  setChildren(
    dialog.footer,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-danger-outline',
        onclick: async () => {
          if (!(await removeTemplateAfterConfirm(controller, template))) return;
          dialog.close();
          onChange(null, template);
        },
      },
      'Löschen',
    ),
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
    busyButton('Speichern', 'speichert …', save, 'btn btn-primary'),
  );
  nameInput.focus();
}

/**
 * Meister: Figur aufstellen (token = null) oder bearbeiten.
 * Beim Aufstellen stehen oben die gespeicherten Figuren: antippen füllt alles aus (Name, LeP,
 * INI, Größe, Farbe, Bild). „Für später merken“ speichert die eingetragene Figur.
 * @param {object} options { controller, token, characters, center() }
 */
export function openTokenDialog({ controller, token = null, characters, center }) {
  const isNew = token === null;
  const dialog = openDialog({ title: isNew ? 'Figur aufstellen' : 'Figur bearbeiten' });
  const values = {
    color: token?.color ?? TOKEN_COLORS[0].id,
    removeImage: false,
    imagePath: null, // Bild einer gespeicherten Figur (beim Aufstellen)
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
  const colors = colorPicker(values.color, (id) => (values.color = id));
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
  const iniInput = h('input', {
    type: 'number',
    class: 'num',
    inputmode: 'numeric',
    min: 0,
    max: MAX_INI_BASE,
    value: token ? (rememberedIni(enemyGroup(token.name)) ?? '') : '',
    placeholder: 'z. B. 12',
    'aria-label': 'INI-Basis',
  });
  const iniField = field('INI-Basis (Kampf)', iniInput, 'Steht im Kampf bei „+ Gegner“ schon drin. Leer = später.');

  // Bild einer gespeicherten Figur – gilt, solange keine neue Datei gewählt ist.
  const templateImage = h('div', { class: 'figure-template-image', hidden: true });
  function showTemplateImage(template) {
    values.imagePath = template?.image_path ?? null;
    templateImage.hidden = !values.imagePath;
    if (!values.imagePath) return;
    setChildren(
      templateImage,
      templateFace(template),
      h('span', {}, `Bild von „${template.name}“`),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => showTemplateImage(null) }, 'Ohne Bild'),
    );
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) showTemplateImage(null); // die neue Datei gilt
  });

  let previousHeroName = heroNameOf(heroSelect.value);
  function updateHeroFields() {
    const isHero = Boolean(heroSelect.value);
    countField.hidden = !isNew || isHero;
    lifeField.hidden = isHero; // Helden haben ihre LeP im Heldenbogen
    iniField.hidden = isHero; // … und ihre INI im Bogen
    rememberButton.hidden = isHero; // gespeichert werden Gegner und NSC
  }
  heroSelect.addEventListener('change', () => {
    const name = heroNameOf(heroSelect.value);
    if (!nameInput.value.trim() || nameInput.value === previousHeroName) nameInput.value = name;
    previousHeroName = name;
    updateHeroFields();
  });

  // Gespeicherte Figuren (nur beim Aufstellen): antippen füllt die Felder aus.
  const templateList = h('div', { class: 'figure-templates', hidden: true });
  function applyTemplate(template) {
    heroSelect.value = '';
    previousHeroName = '';
    nameInput.value = template.name;
    lifeInput.value = template.le_max ?? '';
    iniInput.value = template.ini_base ?? '';
    sizeSelect.value = String(template.size);
    colors.select(template.color);
    fileInput.value = '';
    fileInput.dispatchEvent(new Event('change'));
    showTemplateImage(template);
    updateHeroFields();
    countInput.focus();
    countInput.select();
  }
  /** Eine gespeicherte Figur wurde bearbeitet oder gelöscht (saved = null). */
  function templateChanged(saved, previous) {
    // Steht ihr altes Bild gerade im Formular, das neue nehmen (das alte ist evtl. schon gelöscht).
    if (previous.image_path && values.imagePath === previous.image_path) showTemplateImage(saved);
    renderTemplates(controller.state.get().templates);
  }

  function renderTemplates(templates) {
    templateList.hidden = templates.length === 0;
    setChildren(
      templateList,
      h('span', { class: 'field-label' }, 'Gespeicherte Figuren'),
      h(
        'div',
        { class: 'figure-template-list' },
        templates.map((template) =>
          h(
            'div',
            { class: 'figure-template' },
            h(
              'button',
              {
                type: 'button',
                class: 'figure-template-use',
                'aria-label': `Gespeicherte Figur „${template.name}“ übernehmen`,
                onclick: () => applyTemplate(template),
              },
              templateFace(template),
              h(
                'span',
                { class: 'figure-template-text' },
                h('strong', {}, template.name),
                h('small', {}, templateDetails(template)),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'icon-button figure-template-edit',
                'aria-label': `Gespeicherte Figur „${template.name}“ bearbeiten`,
                onclick: () => openTemplateDialog({ controller, template, onChange: templateChanged }),
              },
              icon(ICONS.edit),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'icon-button figure-template-remove',
                'aria-label': `Gespeicherte Figur „${template.name}“ löschen`,
                onclick: async () => {
                  if (await removeTemplateAfterConfirm(controller, template)) templateChanged(null, template);
                },
              },
              '×',
            ),
          ),
        ),
      ),
    );
  }
  if (isNew) {
    renderTemplates(controller.state.get().templates);
    controller.actions
      .loadTemplates()
      .then(renderTemplates)
      .catch((error) => showError(error, 'Gespeicherte Figuren nicht geladen'));
  }

  /** Eingetragene Figur für später speichern (beim Bearbeiten: Name ohne Nummer, z. B. „Ork“). */
  async function remember() {
    const name = isNew ? nameInput.value.trim() : baseTokenName(nameInput.value);
    if (!name) {
      showToast('Bitte einen Namen eingeben.');
      nameInput.focus();
      return;
    }
    const file = fileInput.files[0] ?? null;
    const keptImage = isNew ? values.imagePath : values.removeImage ? null : token.image_path;
    try {
      const saved = await controller.actions.saveTemplate({
        name,
        color: values.color,
        size: sizeSelect.value,
        leMax: lifeInput.value,
        iniBase: iniInput.value,
        imageFile: file,
        imagePath: keptImage,
      });
      if (isNew) {
        // Das Bild liegt jetzt auf dem Server – beim Aufstellen nicht noch einmal hochladen.
        fileInput.value = '';
        fileInput.dispatchEvent(new Event('change'));
        showTemplateImage(saved);
        renderTemplates(controller.state.get().templates);
      }
      showToast(`„${saved.name}“ gemerkt – beim Aufstellen oben unter „Gespeicherte Figuren“.`);
    } catch (error) {
      showError(error, 'Figur nicht gespeichert');
    }
  }
  const rememberButton = busyButton('★ Für später merken', 'speichert …', remember, 'btn figure-remember');

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
    isNew ? templateList : null,
    field('Name', nameInput),
    characters.length ? field('Gehört zu Held', heroSelect, 'Der Spieler dieses Helden darf die Figur bewegen.') : null,
    isNew ? countField : null,
    lifeField,
    iniField,
    field('Größe', sizeSelect),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbe'), colors.element),
    picker.element,
    isNew ? templateImage : null,
    removeImage,
    h(
      'label',
      { class: 'check' },
      hiddenInput,
      h('span', {}, 'Verborgen – nur du siehst die Figur (z. B. Hinterhalt)'),
    ),
    rememberButton,
  );
  updateHeroFields();

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
    // INI-Basis gilt für die Art (z. B. „Ork“): im Kampf bei „+ Gegner“ schon eingetragen.
    const ini = parseIniBase(iniInput.value);
    if (!spec.characterId && ini !== null) rememberIni(enemyGroup(spec.name), ini);
    try {
      if (isNew) {
        const created = await controller.actions.addTokens(
          {
            ...spec,
            count: spec.characterId ? 1 : countInput.value,
            imageFile: fileInput.files[0] ?? null,
            imagePath: values.imagePath,
          },
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
      colorPicker(values.color, (id) => (values.color = id)).element,
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
