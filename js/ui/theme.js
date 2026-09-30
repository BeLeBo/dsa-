/**
 * theme.js – Hell-/Dunkelmodus: automatisch (Systemeinstellung), hell oder dunkel.
 * Der gewählte Modus wird pro Gerät gespeichert; index.html setzt ihn schon vor dem ersten Zeichnen.
 */
import { readJson, writeJson } from '../storage.js';

const THEME_KEY = 'dsa5.ui.theme';

export const THEMES = Object.freeze([
  { id: 'auto', name: 'Automatisch' },
  { id: 'light', name: 'Hell' },
  { id: 'dark', name: 'Dunkel' },
]);

export function currentTheme() {
  const stored = readJson(THEME_KEY, 'auto');
  return THEMES.some(({ id }) => id === stored) ? stored : 'auto';
}

export function applyTheme(theme = currentTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function setTheme(theme) {
  writeJson(THEME_KEY, theme);
  applyTheme(theme);
}
