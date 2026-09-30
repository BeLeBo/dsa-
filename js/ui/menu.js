/**
 * menu.js – Menü: Held exportieren/importieren, neuen Helden anlegen, Darstellung wählen.
 */
import { h } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { showToast, showError } from './toast.js';
import { THEMES, currentTheme, setTheme } from './theme.js';
import { createHero, exportHero, importHero, heroName } from '../sheet.js';
import { downloadText, safeFilename } from '../util.js';

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}

/** Menü öffnen. deps: { store } */
export function openMenu({ store }) {
  const dialog = openDialog({ title: 'Menü', className: 'dialog-small' });

  function exportCurrent() {
    const hero = store.hero;
    downloadText(`${safeFilename(hero.general.name)}.json`, exportHero(hero));
    showToast('Held als JSON-Datei gespeichert.');
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const imported = importHero(await readFileText(file));
      const question = `„${heroName(store.hero)}“ auf diesem Gerät durch „${heroName(imported)}“ ersetzen?`;
      if (!(await confirmDialog(question, { confirmLabel: 'Ersetzen', danger: true }))) return;
      store.replace(imported);
      showToast(`„${heroName(imported)}“ wurde importiert.`);
    } catch (error) {
      showError(error, 'Import fehlgeschlagen');
    }
  }

  async function createNew() {
    dialog.close();
    const question = `Neuen, leeren Helden anlegen? „${heroName(store.hero)}“ wird dabei überschrieben – vorher am besten exportieren.`;
    if (await confirmDialog(question, { confirmLabel: 'Neu anlegen', danger: true })) {
      store.replace(createHero());
    }
  }

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: (event) => {
      dialog.close();
      importFile(event.target.files[0]);
    },
  });

  const themeButtons = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'Darstellung' },
    THEMES.map(({ id, name }) =>
      h(
        'button',
        {
          type: 'button',
          class: id === currentTheme() ? 'active' : '',
          'aria-pressed': String(id === currentTheme()),
          onclick: (event) => {
            setTheme(id);
            for (const button of event.currentTarget.parentElement.children) {
              const active = button === event.currentTarget;
              button.classList.toggle('active', active);
              button.setAttribute('aria-pressed', String(active));
            }
          },
        },
        name,
      ),
    ),
  );

  dialog.body.append(
    h(
      'div',
      { class: 'menu-list' },
      h(
        'button',
        { type: 'button', class: 'btn menu-item', onclick: exportCurrent },
        'Held exportieren (JSON-Sicherung)',
      ),
      h('button', { type: 'button', class: 'btn menu-item', onclick: () => fileInput.click() }, 'Held importieren …'),
      h(
        'button',
        { type: 'button', class: 'btn menu-item btn-danger-outline', onclick: createNew },
        'Neuen Helden anlegen',
      ),
      fileInput,
    ),
    h('h3', {}, 'Darstellung'),
    themeButtons,
    h('p', { class: 'section-hint' }, 'Der Held wird auf diesem Gerät gespeichert. Sichere ihn regelmäßig per Export.'),
    h(
      'p',
      { class: 'section-hint' },
      h('a', { href: 'tests/rules.test.html', target: '_blank', rel: 'noopener' }, 'Regeltests öffnen'),
    ),
  );
}
