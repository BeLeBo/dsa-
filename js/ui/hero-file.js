/**
 * hero-file.js – Helden als JSON-Datei sichern und wieder laden.
 */
import { showToast } from './toast.js';
import { exportHero, importHero } from '../sheet.js';
import { downloadText, safeFilename } from '../util.js';

/** Bietet den Helden als JSON-Datei zum Herunterladen an. */
export function downloadHero(hero) {
  downloadText(`${safeFilename(hero.general.name)}.json`, exportHero(hero));
  showToast('Held als JSON-Datei gespeichert.');
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsText(file);
  });
}

/**
 * Lässt eine Helden-Datei auswählen (muss aus einem Klick heraus aufgerufen werden).
 * Liefert den geprüften Helden oder null bei Abbruch; wirft HeroImportError bei ungültiger Datei.
 */
export function pickHeroFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(importHero(await readFileText(file)));
      } catch (error) {
        reject(error);
      }
    });
    input.click();
  });
}
