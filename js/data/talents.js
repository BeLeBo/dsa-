/**
 * talents.js – Stammdaten: DSA5-Talente, Kampftechniken und Arten von Zaubern/Liturgien.
 * Die Probeneigenschaften sind Vorgaben; im Heldenbogen lassen sie sich ändern.
 */

export const TALENT_GROUPS = Object.freeze([
  { id: 'koerper', name: 'Körper' },
  { id: 'gesellschaft', name: 'Gesellschaft' },
  { id: 'natur', name: 'Natur' },
  { id: 'wissen', name: 'Wissen' },
  { id: 'handwerk', name: 'Handwerk' },
]);

/**
 * encumbrance: Erschwert Belastung Proben auf dieses Talent? (offizielle Angabe „Belastung: ja/nein“
 * im DSA5-Regel-Wiki; ja = Belastung aus Rüstung zählt bei der Probe automatisch mit).
 */
function talent(id, name, group, check, encumbrance) {
  return Object.freeze({ id, name, group, check: Object.freeze(check.split('/')), encumbrance });
}

export const TALENTS = Object.freeze([
  // Körper
  talent('fliegen', 'Fliegen', 'koerper', 'MU/IN/GE', true),
  talent('gaukeleien', 'Gaukeleien', 'koerper', 'MU/CH/FF', true),
  talent('klettern', 'Klettern', 'koerper', 'MU/GE/KK', true),
  talent('koerperbeherrschung', 'Körperbeherrschung', 'koerper', 'GE/GE/KO', true),
  talent('kraftakt', 'Kraftakt', 'koerper', 'KO/KK/KK', true),
  talent('reiten', 'Reiten', 'koerper', 'CH/GE/KK', true),
  talent('schwimmen', 'Schwimmen', 'koerper', 'GE/KO/KK', true),
  talent('selbstbeherrschung', 'Selbstbeherrschung', 'koerper', 'MU/MU/KO', false),
  talent('singen', 'Singen', 'koerper', 'KL/CH/KO', false),
  talent('sinnesschaerfe', 'Sinnesschärfe', 'koerper', 'KL/IN/IN', false),
  talent('tanzen', 'Tanzen', 'koerper', 'KL/CH/GE', true),
  talent('taschendiebstahl', 'Taschendiebstahl', 'koerper', 'MU/FF/GE', true),
  talent('verbergen', 'Verbergen', 'koerper', 'MU/IN/GE', true),
  talent('zechen', 'Zechen', 'koerper', 'KL/KO/KK', false),
  // Gesellschaft
  talent('bekehren', 'Bekehren & Überzeugen', 'gesellschaft', 'MU/KL/CH', false),
  talent('betoeren', 'Betören', 'gesellschaft', 'MU/CH/CH', false),
  talent('einschuechtern', 'Einschüchtern', 'gesellschaft', 'MU/IN/CH', false),
  talent('etikette', 'Etikette', 'gesellschaft', 'KL/IN/CH', false),
  talent('gassenwissen', 'Gassenwissen', 'gesellschaft', 'KL/IN/CH', false),
  talent('menschenkenntnis', 'Menschenkenntnis', 'gesellschaft', 'KL/IN/CH', false),
  talent('ueberreden', 'Überreden', 'gesellschaft', 'MU/IN/CH', false),
  talent('verkleiden', 'Verkleiden', 'gesellschaft', 'IN/CH/GE', true),
  talent('willenskraft', 'Willenskraft', 'gesellschaft', 'MU/IN/CH', false),
  // Natur
  talent('faehrtensuchen', 'Fährtensuchen', 'natur', 'MU/IN/GE', true),
  talent('fesseln', 'Fesseln', 'natur', 'KL/FF/KK', false),
  talent('fischen', 'Fischen & Angeln', 'natur', 'FF/GE/KO', true),
  talent('orientierung', 'Orientierung', 'natur', 'KL/IN/IN', false),
  talent('pflanzenkunde', 'Pflanzenkunde', 'natur', 'KL/FF/KO', true),
  talent('tierkunde', 'Tierkunde', 'natur', 'MU/MU/CH', true),
  talent('wildnisleben', 'Wildnisleben', 'natur', 'MU/GE/KO', true),
  // Wissen
  talent('brettspiel', 'Brett- & Glücksspiel', 'wissen', 'KL/KL/IN', false),
  talent('geographie', 'Geographie', 'wissen', 'KL/KL/IN', false),
  talent('geschichtswissen', 'Geschichtswissen', 'wissen', 'KL/KL/IN', false),
  talent('goetter', 'Götter & Kulte', 'wissen', 'KL/KL/IN', false),
  talent('kriegskunst', 'Kriegskunst', 'wissen', 'MU/KL/IN', false),
  talent('magiekunde', 'Magiekunde', 'wissen', 'KL/KL/IN', false),
  talent('mechanik', 'Mechanik', 'wissen', 'KL/KL/FF', false),
  talent('rechnen', 'Rechnen', 'wissen', 'KL/KL/IN', false),
  talent('rechtskunde', 'Rechtskunde', 'wissen', 'KL/KL/IN', false),
  talent('sagen', 'Sagen & Legenden', 'wissen', 'KL/KL/IN', false),
  talent('sphaerenkunde', 'Sphärenkunde', 'wissen', 'KL/KL/IN', false),
  talent('sternkunde', 'Sternkunde', 'wissen', 'KL/KL/IN', false),
  // Handwerk
  talent('alchimie', 'Alchimie', 'handwerk', 'MU/KL/FF', true),
  talent('boote', 'Boote & Schiffe', 'handwerk', 'FF/GE/KK', true),
  talent('fahrzeuge', 'Fahrzeuge', 'handwerk', 'CH/FF/KO', true),
  talent('handel', 'Handel', 'handwerk', 'KL/IN/CH', false),
  talent('heilkunde_gift', 'Heilkunde Gift', 'handwerk', 'MU/KL/IN', true),
  talent('heilkunde_krankheiten', 'Heilkunde Krankheiten', 'handwerk', 'MU/IN/KO', true),
  talent('heilkunde_seele', 'Heilkunde Seele', 'handwerk', 'IN/CH/KO', false),
  talent('heilkunde_wunden', 'Heilkunde Wunden', 'handwerk', 'KL/FF/FF', true),
  talent('holzbearbeitung', 'Holzbearbeitung', 'handwerk', 'FF/GE/KK', true),
  talent('lebensmittelbearbeitung', 'Lebensmittelbearbeitung', 'handwerk', 'IN/FF/FF', true),
  talent('lederbearbeitung', 'Lederbearbeitung', 'handwerk', 'FF/GE/KO', true),
  talent('malen', 'Malen & Zeichnen', 'handwerk', 'IN/FF/FF', true),
  talent('metallbearbeitung', 'Metallbearbeitung', 'handwerk', 'FF/KO/KK', true),
  talent('musizieren', 'Musizieren', 'handwerk', 'CH/FF/KO', true),
  talent('schloesserknacken', 'Schlösserknacken', 'handwerk', 'IN/FF/FF', true),
  talent('steinbearbeitung', 'Steinbearbeitung', 'handwerk', 'FF/FF/KK', true),
  talent('stoffbearbeitung', 'Stoffbearbeitung', 'handwerk', 'KL/FF/FF', true),
]);

function technique(id, name, leading, ranged = false) {
  return Object.freeze({ id, name, leading: Object.freeze(leading.split('/')), ranged });
}

/** Kampftechniken mit Leiteigenschaft(en). Nahkampf: AT/PA, Fernkampf: FK. */
export const COMBAT_TECHNIQUES = Object.freeze([
  technique('dolche', 'Dolche', 'GE'),
  technique('faecher', 'Fächer', 'GE'),
  technique('fechtwaffen', 'Fechtwaffen', 'GE'),
  technique('hiebwaffen', 'Hiebwaffen', 'KK'),
  technique('kettenwaffen', 'Kettenwaffen', 'KK'),
  technique('lanzen', 'Lanzen', 'KK'),
  technique('peitschen', 'Peitschen', 'FF'),
  technique('raufen', 'Raufen', 'GE/KK'),
  technique('schilde', 'Schilde', 'KK'),
  technique('schwerter', 'Schwerter', 'GE/KK'),
  technique('spiesswaffen', 'Spießwaffen', 'KK'),
  technique('stangenwaffen', 'Stangenwaffen', 'GE/KK'),
  technique('zweihandhiebwaffen', 'Zweihandhiebwaffen', 'KK'),
  technique('zweihandschwerter', 'Zweihandschwerter', 'KK'),
  technique('armbrueste', 'Armbrüste', 'FF', true),
  technique('blasrohre', 'Blasrohre', 'FF', true),
  technique('boegen', 'Bögen', 'FF', true),
  technique('diskusse', 'Diskusse', 'FF', true),
  technique('schleudern', 'Schleudern', 'FF', true),
  technique('wurfwaffen', 'Wurfwaffen', 'FF', true),
]);

/** Startwert jeder Kampftechnik laut DSA5. */
export const DEFAULT_KTW = 6;

/** Arten übernatürlicher Fertigkeiten und die Energie, die sie kosten. */
export const SPELL_TYPES = Object.freeze([
  { id: 'zauber', name: 'Zauber', resource: 'asp' },
  { id: 'ritual', name: 'Ritual', resource: 'asp' },
  { id: 'liturgie', name: 'Liturgie', resource: 'kap' },
  { id: 'zeremonie', name: 'Zeremonie', resource: 'kap' },
]);

export const RESOURCE_NAMES = Object.freeze({ asp: 'AsP', kap: 'KaP' });
