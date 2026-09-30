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

function talent(id, name, group, check) {
  return Object.freeze({ id, name, group, check: Object.freeze(check.split('/')) });
}

export const TALENTS = Object.freeze([
  // Körper
  talent('fliegen', 'Fliegen', 'koerper', 'MU/IN/GE'),
  talent('gaukeleien', 'Gaukeleien', 'koerper', 'MU/CH/FF'),
  talent('klettern', 'Klettern', 'koerper', 'MU/GE/KK'),
  talent('koerperbeherrschung', 'Körperbeherrschung', 'koerper', 'GE/GE/KO'),
  talent('kraftakt', 'Kraftakt', 'koerper', 'KO/KK/KK'),
  talent('reiten', 'Reiten', 'koerper', 'CH/GE/KK'),
  talent('schwimmen', 'Schwimmen', 'koerper', 'GE/KO/KK'),
  talent('selbstbeherrschung', 'Selbstbeherrschung', 'koerper', 'MU/MU/KO'),
  talent('singen', 'Singen', 'koerper', 'KL/CH/KO'),
  talent('sinnesschaerfe', 'Sinnesschärfe', 'koerper', 'KL/IN/IN'),
  talent('tanzen', 'Tanzen', 'koerper', 'KL/CH/GE'),
  talent('taschendiebstahl', 'Taschendiebstahl', 'koerper', 'MU/FF/GE'),
  talent('verbergen', 'Verbergen', 'koerper', 'MU/IN/GE'),
  talent('zechen', 'Zechen', 'koerper', 'KL/KO/KK'),
  // Gesellschaft
  talent('bekehren', 'Bekehren & Überzeugen', 'gesellschaft', 'MU/KL/CH'),
  talent('betoeren', 'Betören', 'gesellschaft', 'MU/CH/CH'),
  talent('einschuechtern', 'Einschüchtern', 'gesellschaft', 'MU/IN/CH'),
  talent('etikette', 'Etikette', 'gesellschaft', 'KL/IN/CH'),
  talent('gassenwissen', 'Gassenwissen', 'gesellschaft', 'KL/IN/CH'),
  talent('menschenkenntnis', 'Menschenkenntnis', 'gesellschaft', 'KL/IN/CH'),
  talent('ueberreden', 'Überreden', 'gesellschaft', 'MU/IN/CH'),
  talent('verkleiden', 'Verkleiden', 'gesellschaft', 'IN/CH/GE'),
  talent('willenskraft', 'Willenskraft', 'gesellschaft', 'MU/IN/CH'),
  // Natur
  talent('faehrtensuchen', 'Fährtensuchen', 'natur', 'MU/IN/GE'),
  talent('fesseln', 'Fesseln', 'natur', 'KL/FF/KK'),
  talent('fischen', 'Fischen & Angeln', 'natur', 'FF/GE/KO'),
  talent('orientierung', 'Orientierung', 'natur', 'KL/IN/IN'),
  talent('pflanzenkunde', 'Pflanzenkunde', 'natur', 'KL/FF/KO'),
  talent('tierkunde', 'Tierkunde', 'natur', 'MU/MU/CH'),
  talent('wildnisleben', 'Wildnisleben', 'natur', 'MU/GE/KO'),
  // Wissen
  talent('brettspiel', 'Brett- & Glücksspiel', 'wissen', 'KL/KL/IN'),
  talent('geographie', 'Geographie', 'wissen', 'KL/KL/IN'),
  talent('geschichtswissen', 'Geschichtswissen', 'wissen', 'KL/KL/IN'),
  talent('goetter', 'Götter & Kulte', 'wissen', 'KL/KL/IN'),
  talent('kriegskunst', 'Kriegskunst', 'wissen', 'MU/KL/IN'),
  talent('magiekunde', 'Magiekunde', 'wissen', 'KL/KL/IN'),
  talent('mechanik', 'Mechanik', 'wissen', 'KL/KL/FF'),
  talent('rechnen', 'Rechnen', 'wissen', 'KL/KL/IN'),
  talent('rechtskunde', 'Rechtskunde', 'wissen', 'KL/KL/IN'),
  talent('sagen', 'Sagen & Legenden', 'wissen', 'KL/KL/IN'),
  talent('sphaerenkunde', 'Sphärenkunde', 'wissen', 'KL/KL/IN'),
  talent('sternkunde', 'Sternkunde', 'wissen', 'KL/KL/IN'),
  // Handwerk
  talent('alchimie', 'Alchimie', 'handwerk', 'MU/KL/FF'),
  talent('boote', 'Boote & Schiffe', 'handwerk', 'FF/GE/KK'),
  talent('fahrzeuge', 'Fahrzeuge', 'handwerk', 'CH/FF/KO'),
  talent('handel', 'Handel', 'handwerk', 'KL/IN/CH'),
  talent('heilkunde_gift', 'Heilkunde Gift', 'handwerk', 'MU/KL/IN'),
  talent('heilkunde_krankheiten', 'Heilkunde Krankheiten', 'handwerk', 'MU/IN/KO'),
  talent('heilkunde_seele', 'Heilkunde Seele', 'handwerk', 'IN/CH/KO'),
  talent('heilkunde_wunden', 'Heilkunde Wunden', 'handwerk', 'KL/FF/FF'),
  talent('holzbearbeitung', 'Holzbearbeitung', 'handwerk', 'FF/GE/KK'),
  talent('lebensmittelbearbeitung', 'Lebensmittelbearbeitung', 'handwerk', 'IN/FF/FF'),
  talent('lederbearbeitung', 'Lederbearbeitung', 'handwerk', 'FF/GE/KO'),
  talent('malen', 'Malen & Zeichnen', 'handwerk', 'IN/FF/FF'),
  talent('metallbearbeitung', 'Metallbearbeitung', 'handwerk', 'FF/KO/KK'),
  talent('musizieren', 'Musizieren', 'handwerk', 'CH/FF/KO'),
  talent('schloesserknacken', 'Schlösserknacken', 'handwerk', 'IN/FF/FF'),
  talent('steinbearbeitung', 'Steinbearbeitung', 'handwerk', 'FF/FF/KK'),
  talent('stoffbearbeitung', 'Stoffbearbeitung', 'handwerk', 'KL/FF/FF'),
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
