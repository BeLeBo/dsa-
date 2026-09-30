/**
 * mode-local.js – Spielen ohne Raum: Der Held liegt nur im Browser dieses Geräts.
 */
import { createShell, TABS } from './ui/shell.js';
import { showError, showToast } from './ui/toast.js';
import { confirmDialog } from './ui/dialog.js';
import { downloadHero, pickHeroFile } from './ui/hero-file.js';
import { createHeroStore } from './store.js';
import { createSaver } from './saver.js';
import { createLocalLog, LOG_KEY } from './log.js';
import { readJson, writeJson } from './storage.js';
import { createHero, normalizeHero, heroName } from './sheet.js';

export const LOCAL_HERO_KEY = 'dsa5.lokalerHeld';

/** Held aus dem Modus „Ohne Raum“ oder null, wenn auf diesem Gerät keiner gespeichert ist. */
export function readLocalHero() {
  const stored = readJson(LOCAL_HERO_KEY, null);
  return stored ? normalizeHero(stored) : null;
}

/**
 * Startet den Modus „Ohne Raum“.
 * @param {object} options { onLeave() – zurück zur Startseite }
 */
export function startLocalMode({ onLeave }) {
  const store = createHeroStore(readLocalHero() ?? createHero());
  const log = createLocalLog(LOG_KEY);

  const menu = () => ({
    items: [
      { label: 'Held exportieren (JSON-Sicherung)', onClick: () => downloadHero(store.hero) },
      {
        label: 'Held importieren …',
        onClick: async () => {
          const imported = await pickHeroFile();
          if (!imported) return;
          const question = `„${heroName(store.hero)}“ auf diesem Gerät durch „${heroName(imported)}“ ersetzen?`;
          if (!(await confirmDialog(question, { confirmLabel: 'Ersetzen', danger: true }))) return;
          store.replace(imported);
          showToast(`„${heroName(imported)}“ wurde importiert.`);
        },
      },
      {
        label: 'Neuen Helden anlegen',
        danger: true,
        onClick: async () => {
          const question = `Neuen, leeren Helden anlegen? „${heroName(store.hero)}“ wird dabei überschrieben – vorher am besten exportieren.`;
          if (await confirmDialog(question, { confirmLabel: 'Neu anlegen', danger: true })) store.replace(createHero());
        },
      },
      { label: 'Mit einer Gruppe spielen (Raum) …', onClick: onLeave },
    ],
    note: 'Der Held wird nur auf diesem Gerät gespeichert. Sichere ihn regelmäßig per Export.',
  });

  const shell = createShell({
    store,
    log,
    tabs: [TABS.hero, TABS.dice, TABS.log],
    title: () => 'Unbenannter Held',
    subtitle: () => 'Ohne Raum · nur auf diesem Gerät',
    actorName: () => heroName(store.hero),
    renderEmptyHero: () => null,
    menu,
  });

  const saver = createSaver({
    save: () => {
      if (!writeJson(LOCAL_HERO_KEY, store.hero)) {
        throw new Error(
          'Der Browser erlaubt kein Speichern (privater Modus oder Speicher voll). Bitte den Helden exportieren.',
        );
      }
    },
    onStatus: (state, error) => {
      shell.setStatus(state);
      if (error) showError(error, 'Speichern fehlgeschlagen');
    },
  });
  store.subscribe(() => saver.schedule());

  // Beim Verlassen oder Wechseln der App sofort speichern statt auf die Verzögerung zu warten.
  window.addEventListener('pagehide', () => saver.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flush();
  });
}
