/**
 * saver.js – Speichern mit Verzögerung (Debounce) und Statusmeldung.
 *
 * Viele schnelle Änderungen (Tippen) werden zu einem Speichervorgang gebündelt.
 * Läuft gerade ein Speichervorgang, wird danach erneut gespeichert.
 * Status: 'saving' | 'saved' | 'error' (mit Fehlerobjekt)
 */
export const SAVE_DELAY_MS = 800;

export function createSaver({ save, delay = SAVE_DELAY_MS, onStatus = () => {} }) {
  let timer = null;
  let dirty = false;
  let inFlight = null;

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (inFlight) await inFlight;
    if (!dirty) return;
    dirty = false;
    inFlight = (async () => {
      try {
        await save();
        onStatus(dirty ? 'saving' : 'saved');
      } catch (error) {
        dirty = true; // beim nächsten Versuch erneut speichern
        onStatus('error', error);
      }
    })();
    await inFlight;
    inFlight = null;
  }

  /** Meldet eine Änderung; gespeichert wird nach `delay` ms Ruhe. */
  function schedule() {
    dirty = true;
    onStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  return { schedule, flush, hasPendingChanges: () => dirty || inFlight !== null };
}
