/**
 * official-maps.js – Offizielle Karten, die die App mitbringt (Ordner `karten/`). Der Meister legt sie
 * wie eine hochgeladene Karte im Raum an. Zu jeder gehört ein Hinweis (Urheber, Lizenz), den die
 * App bei der Karte anzeigt – das verlangt die Lizenz.
 */

/** Herkunft einer Karte (maps.credit) → Hinweis, der bei ihr steht. */
export const MAP_CREDITS = Object.freeze({
  kartenpaket: Object.freeze({
    text: 'Karte: Ina Kramer · © Ulisses Spiele · DSA-Fanprojekt',
    licenseLabel: 'Lizenz (Ulisses-Kartenpaket)',
    licenseUrl: 'https://de.wiki-aventurica.de/wiki/Kartenpaket/Lizenz',
  }),
});

/** Mitgelieferte Karten (unveränderte Dateien aus dem Ulisses-Kartenpaket). */
export const OFFICIAL_MAPS = Object.freeze([
  Object.freeze({
    id: 'aventurien',
    name: 'Aventurien',
    description: 'Der ganze Kontinent – offizielle Karte von Ina Kramer (Ulisses-Kartenpaket).',
    file: 'karten/aventurien.jpg',
    fileName: 'aventurien.jpg',
    width: 2857,
    height: 4000,
    credit: 'kartenpaket',
  }),
]);

/** Hinweis zu einer Karte – oder null (eigene Karte). */
export function mapCredit(map) {
  return (map && Object.hasOwn(MAP_CREDITS, map.credit ?? '') && MAP_CREDITS[map.credit]) || null;
}

/** Gibt es diese mitgelieferte Karte im Raum schon? (gleicher Name und Herkunft) */
export function findOfficialMap(maps, official) {
  return (
    maps.find(
      (map) => map.credit === official.credit && map.name.trim().toLowerCase() === official.name.toLowerCase(),
    ) ?? null
  );
}
