/**
 * official-maps.js – Offizielle Karten, die die App mitbringt (Ordner `karten/`, unverändert aus dem
 * Kartenpaket von Ulisses Spiele). Der Meister legt sie wie eine hochgeladene Karte im Raum an. Zu
 * jeder gehört ein Hinweis (Urheber, Rechte, Lizenz), den die App bei der Karte anzeigt – das
 * verlangt die Lizenz.
 */

const LICENSE_URL = 'https://de.wiki-aventurica.de/wiki/Kartenpaket/Lizenz';
const KRAMER = 'Ina Kramer';

/** Herkunft einer Karte (maps.credit) → Rechte und Lizenz. */
export const MAP_CREDITS = Object.freeze({
  kartenpaket: Object.freeze({
    rights: '© Ulisses Spiele · DSA-Fanprojekt',
    licenseLabel: 'Lizenz (Ulisses-Kartenpaket)',
    licenseUrl: LICENSE_URL,
    /** Falls die Karte umbenannt wurde und sich nicht mehr zuordnen lässt. */
    fallbackAuthor: 'Ina Kramer u. a. (Ulisses-Kartenpaket)',
  }),
});

const official = (id, name, size, extra = {}) =>
  Object.freeze({
    id,
    name,
    file: `karten/${id}.jpg`,
    fileName: `${id}.jpg`,
    width: size[0],
    height: size[1],
    author: KRAMER,
    credit: 'kartenpaket',
    kind: 'region',
    ...extra,
  });

/**
 * Mitgelieferte Karten: der ganze Kontinent, die Regionalkarten (grob von Nord nach Süd) und die
 * politische Karte.
 */
export const OFFICIAL_MAPS = Object.freeze([
  official('aventurien', 'Aventurien', [2857, 4000], {
    kind: 'continent',
    description: 'Der ganze Kontinent – offizielle Karte von Ina Kramer (Ulisses-Kartenpaket).',
  }),
  official('nordwest-aventurien', 'Nordwest-Aventurien', [1552, 2000]),
  official('westliches-nivesenland', 'Westliches Nivesenland', [1200, 2000]),
  official('oestliches-nivesenland', 'Östliches Nivesenland', [1200, 2000]),
  official('orkland-svellttal', 'Orkland, Svellttal und Umgebung', [2000, 1619]),
  official('bornland', 'Das Bornland und Umgebung', [2000, 2000]),
  official('westliches-mittelreich', 'Das westliche Mittelreich', [2000, 1872]),
  official('zentrales-mittelreich', 'Das zentrale Mittelreich', [2000, 1578]),
  official('schildlande', 'Schildlande', [2500, 1764]),
  official('liebliches-feld', 'Das Liebliche Feld und die Zyklopeninseln', [2000, 1952]),
  official('oestliche-tulamidenlande', 'Die östlichen Tulamidenlande', [1682, 2000]),
  official('khom', 'Die Wüste Khôm und die angrenzenden Gebiete', [1665, 2000]),
  official('maraskan', 'Maraskan und die umgebenden Inseln', [1198, 2000]),
  official('al-anfa-regengebirge', "Al'Anfa und das Regengebirge", [1542, 2000]),
  official('altoum-waldinseln', 'Altoum und die Waldinseln', [2000, 862]),
  official('politische-karte-30-hal', 'Politische Grenzen und Anspruchsgebiete 30 Hal', [1366, 2000], {
    kind: 'political',
    author: 'Michael Meyhöfer',
  }),
]);

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Mitgelieferte Karte zu einer Karte im Raum (gleiche Herkunft und Name) – oder null. */
function officialFor(map) {
  return OFFICIAL_MAPS.find((entry) => entry.credit === map.credit && sameName(entry.name, map.name ?? '')) ?? null;
}

/**
 * Hinweis zu einer Karte: { text, licenseLabel, licenseUrl } – oder null (eigene Karte).
 * text nennt Urheber und Rechte, z. B. „Karte: Ina Kramer · © Ulisses Spiele · DSA-Fanprojekt“.
 */
export function mapCredit(map) {
  if (!map || !Object.hasOwn(MAP_CREDITS, map.credit ?? '')) return null;
  const credit = MAP_CREDITS[map.credit];
  const author = officialFor(map)?.author ?? credit.fallbackAuthor;
  return {
    text: `Karte: ${author} · ${credit.rights}`,
    licenseLabel: credit.licenseLabel,
    licenseUrl: credit.licenseUrl,
  };
}

/** Gibt es diese mitgelieferte Karte im Raum schon? (gleicher Name und Herkunft) */
export function findOfficialMap(maps, entry) {
  return maps.find((map) => map.credit === entry.credit && sameName(map.name ?? '', entry.name)) ?? null;
}
