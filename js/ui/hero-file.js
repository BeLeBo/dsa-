/**
 * hero-file.js – Helden als JSON-Datei sichern und wieder laden – auch aus Optolith.
 */
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { showToast } from './toast.js';
import { exportHero } from '../sheet.js';
import { readHeroFiles } from '../hero-files.js';
import { downloadText, safeFilename } from '../util.js';

/** Bietet den Helden als JSON-Datei zum Herunterladen an. */
export function downloadHero(hero) {
  downloadText(`${safeFilename(hero.general.name)}.json`, exportHero(hero));
  showToast('Held als JSON-Datei gespeichert.');
}

/**
 * Lässt Helden-Dateien auswählen (muss aus einem Klick heraus aufgerufen werden): eine eigene
 * Sicherung oder die Exporte aus Optolith (.rptok und/oder .json, auch beide zusammen).
 * Liefert { hero, report } oder null bei Abbruch; wirft HeroImportError bei ungültigen Dateien.
 */
export function pickHeroFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.json,.rptok,application/json';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', async () => {
      if (!input.files?.length) return resolve(null);
      try {
        resolve(await readHeroFiles(input.files));
      } catch (error) {
        reject(error);
      }
    });
    input.click();
  });
}

/** Zeigt nach einem Import aus Optolith, was übernommen wurde und was noch fehlt. */
export function showImportReport(report) {
  if (!report) return;
  const dialog = openDialog({ title: 'Import aus Optolith' });
  const list = (items) =>
    h(
      'ul',
      { class: 'import-list' },
      items.map((item) => h('li', {}, item)),
    );
  dialog.body.append(
    h('h3', {}, 'Übernommen'),
    list(report.imported),
    h('h3', {}, 'Bitte prüfen oder ergänzen'),
    report.todo.length ? list(report.todo) : h('p', { class: 'section-hint' }, 'Nichts – alles da.'),
    h('p', { class: 'section-hint' }, 'Alle Änderungen im Heldenbogen werden wie gewohnt automatisch gespeichert.'),
  );
  dialog.footer.append(
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Alles klar'),
  );
}

/** Kurzanleitung für den Import (Startseite des Helden, Menü). */
export const IMPORT_HINT =
  'Aus Optolith: Unter „Heldenbögen“ den MapTool-Export (.rptok) speichern – am besten zusammen mit der Heldendatei (.json aus der Heldenliste) auswählen.';
