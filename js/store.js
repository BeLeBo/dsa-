/**
 * store.js – Hält den aktuellen Helden und benachrichtigt Ansichten über Änderungen.
 *
 * Ansichten ändern `store.hero` direkt und melden danach `store.changed(art, quelle)`:
 *   'value'     – ein Wert hat sich geändert (Eingabefelder bleiben bestehen)
 *   'structure' – Einträge hinzugefügt/entfernt (Listen neu aufbauen)
 *   'replace'   – ganz anderer Held oder gar keiner (alles neu aufbauen)
 * `quelle` ist das auslösende Element, die Ansicht oder REMOTE (Änderung vom Server),
 * damit niemand seine eigene Änderung erneut verarbeitet.
 */

/** Quelle für Änderungen, die vom Server kommen (werden nicht zurückgespeichert). */
export const REMOTE = 'remote';

export function createHeroStore(initialHero) {
  let hero = initialHero;
  const listeners = new Set();

  function emit(kind, source) {
    for (const listener of listeners) listener(kind, source);
  }

  return {
    /** Aktueller Held oder null (z. B. Meister ohne ausgewählten Helden). */
    get hero() {
      return hero;
    },
    replace(nextHero, source = null) {
      hero = nextHero;
      emit('replace', source);
    },
    /** Ersetzt den Helden durch eine neue Fassung desselben Helden (z. B. nach Zusammenführen). */
    update(nextHero, kind, source) {
      hero = nextHero;
      emit(kind, source);
    },
    changed(kind = 'value', source = null) {
      emit(kind, source);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Kleiner beobachtbarer Wert (z. B. Rauminfos für die Gruppenansicht). */
export function createObservable(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    get: () => value,
    set(nextValue) {
      value = nextValue;
      for (const listener of listeners) listener(value);
    },
    update(changes) {
      this.set({ ...value, ...changes });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
