/**
 * store.js – Hält den aktuellen Helden und benachrichtigt Ansichten über Änderungen.
 *
 * Ansichten ändern `store.hero` direkt und melden danach `store.changed(art, quelle)`:
 *   'value'     – ein Wert hat sich geändert (Eingabefelder bleiben bestehen)
 *   'structure' – Einträge hinzugefügt/entfernt (Listen neu aufbauen)
 *   'replace'   – ganz anderer Held (alles neu aufbauen)
 * `quelle` ist das auslösende Element bzw. die Ansicht, damit sie sich nicht selbst stört.
 */
export function createHeroStore(initialHero) {
  let hero = initialHero;
  const listeners = new Set();

  function emit(kind, source) {
    for (const listener of listeners) listener(kind, source);
  }

  return {
    get hero() {
      return hero;
    },
    replace(nextHero) {
      hero = nextHero;
      emit('replace', null);
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
