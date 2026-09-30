/**
 * parts.js – Wiederkehrende Bausteine des Heldenbogens.
 */
import { h, icon, ICONS } from '../dom.js';
import { readJson, writeJson } from '../../storage.js';
import { getPath } from '../../util.js';

const SECTION_STATE_KEY = 'dsa5.ui.bereiche';
const sectionState = readJson(SECTION_STATE_KEY, {}) ?? {};

/** Einklappbarer Bereich; der Auf-/Zu-Zustand wird pro Gerät gemerkt. */
export function section(id, title, content, { defaultOpen = true, className = '', badge = null } = {}) {
  const details = h(
    'details',
    { class: `section ${className}`.trim(), open: sectionState[id] ?? defaultOpen, dataset: { section: id } },
    h('summary', {}, h('span', { class: 'section-title' }, title), badge),
    h('div', { class: 'section-body' }, content),
  );
  details.addEventListener('toggle', () => {
    sectionState[id] = details.open;
    writeJson(SECTION_STATE_KEY, sectionState);
  });
  return details;
}

/** Knopf, der eine Aktion des Heldenbogens auslöst (siehe view.js). */
export function actionButton(action, arg, content, { className = 'btn', label = null } = {}) {
  return h('button', { type: 'button', class: className, 'aria-label': label, dataset: { action, arg } }, content);
}

/** Wert, der aus dem Helden berechnet und bei jeder Änderung aktualisiert wird. */
export function derived(name, arg = '', { tag = 'span', className = '' } = {}) {
  return h(tag, { class: className, dataset: { derived: arg === '' ? name : `${name}:${arg}` } });
}

/** Bearbeiten-Knopf (Stift), der einen Bereich unter einer Zeile auf- und zuklappt. */
export function editorToggle(key, isOpen, label) {
  return actionButton('toggle-editor', key, icon(ICONS.edit), {
    className: `icon-button ${isOpen ? 'active' : ''}`.trim(),
    label,
  });
}

export function addButton(listKey, label) {
  return actionButton('add-entry', listKey, [icon(ICONS.plus), h('span', {}, label)], { className: 'btn btn-add' });
}

export function removeButton(listKey, id, label) {
  return actionButton('remove-entry', `${listKey}:${id}`, icon(ICONS.trash), {
    className: 'icon-button danger',
    label,
  });
}

/** Suchfeld, das Zeilen mit data-search filtert. */
export function searchField(id, value, placeholder) {
  return h(
    'label',
    { class: 'search' },
    icon(ICONS.search),
    h('input', {
      type: 'search',
      placeholder,
      value,
      'aria-label': placeholder,
      autocomplete: 'off',
      dataset: { search: id },
    }),
  );
}

/**
 * Blendet Zeilen aus, deren Name nicht zur Suche passt, und leere Gruppen gleich mit.
 * Zeilen tragen data-search-row und entweder data-search-text (fester Name)
 * oder data-search-path (Name steht im Helden, z. B. „spells.2.name“).
 */
export function applySearch(root, id, query, hero) {
  const needle = query.trim().toLocaleLowerCase('de');
  const scope = root.querySelector(`[data-search-scope="${id}"]`);
  if (!scope) return;
  for (const row of scope.querySelectorAll('[data-search-row]')) {
    const text = row.dataset.searchText ?? String(getPath(hero, row.dataset.searchPath) ?? '');
    row.hidden = needle !== '' && !text.toLocaleLowerCase('de').includes(needle);
  }
  for (const group of scope.querySelectorAll('[data-search-group]')) {
    const visible = group.querySelectorAll('[data-search-row]:not([hidden])').length;
    group.hidden = visible === 0;
    if (needle !== '' && visible > 0) group.open = true;
  }
}

export function emptyHint(text) {
  return h('p', { class: 'empty-hint' }, text);
}
