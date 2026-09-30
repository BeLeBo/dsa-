/**
 * theme.js – Darstellung: Hell-/Dunkelmodus (automatisch, hell, dunkel) und Schriftgröße.
 * Die Wahl wird pro Gerät gespeichert; index.html setzt sie schon vor dem ersten Zeichnen.
 */
import { readJson, writeJson } from '../storage.js';

const THEME_KEY = 'dsa5.ui.theme';
const TEXT_SIZE_KEY = 'dsa5.ui.schrift';

/** Farbe der Browserleiste passend zur Kopfzeile. */
const BAR_COLORS = Object.freeze({ light: '#ffffff', dark: '#1c1a17' });

export const THEMES = Object.freeze([
  { id: 'auto', name: 'Automatisch' },
  { id: 'light', name: 'Hell' },
  { id: 'dark', name: 'Dunkel' },
]);

export const TEXT_SIZES = Object.freeze([
  { id: 'normal', name: 'Normal' },
  { id: 'gross', name: 'Groß' },
  { id: 'sehr-gross', name: 'Sehr groß' },
]);

function storedChoice(key, options, fallback) {
  const stored = readJson(key, fallback);
  return options.some(({ id }) => id === stored) ? stored : fallback;
}

export function currentTheme() {
  return storedChoice(THEME_KEY, THEMES, 'auto');
}

export function currentTextSize() {
  return storedChoice(TEXT_SIZE_KEY, TEXT_SIZES, 'normal');
}

function applyBarColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const systemTheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = BAR_COLORS[theme === 'auto' ? systemTheme : theme];
  }
}

/** Setzt Farbmodus und Schriftgröße am Dokument. */
export function applyTheme(theme = currentTheme(), textSize = currentTextSize()) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (textSize === 'normal') delete root.dataset.text;
  else root.dataset.text = textSize;
  applyBarColor(theme);
}

export function setTheme(theme) {
  writeJson(THEME_KEY, theme);
  applyTheme(theme, currentTextSize());
}

export function setTextSize(textSize) {
  writeJson(TEXT_SIZE_KEY, textSize);
  applyTheme(currentTheme(), textSize);
}
