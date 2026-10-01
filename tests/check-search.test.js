/**
 * check-search.test.js – Proben auf der Karte finden (check-search.js).
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  searchKey,
  specKey,
  checkChoices,
  searchChecks,
  recentChoices,
  rememberRecent,
  checkSections,
  choicesByKeys,
  toggleKey,
  MAX_RECENT,
} from '../js/check-search.js';
import { createHero, createWeapon, createSpell } from '../js/sheet.js';

const GROUP = 'Proben auf der Karte (check-search.js)';

function testHero() {
  const hero = createHero();
  hero.attributes.MU = 14;
  hero.talents.find((talent) => talent.id === 'sinnesschaerfe').fw = 7;
  hero.weapons = [
    { ...createWeapon(), id: 'w1', name: 'Langschwert', technique: 'schwerter' },
    { ...createWeapon(), id: 'w2', name: 'Kurzbogen', technique: 'boegen' },
  ];
  hero.spells = [
    { ...createSpell(), id: 's1', name: 'Ignifaxius', fw: 9 },
    { ...createSpell(), id: 's2', name: 'Segen der Heiligen Noionitin', type: 'liturgie' },
  ];
  return hero;
}

test(GROUP, 'Suchschlüssel: Umlaute, ß und Groß/klein egal', () => {
  assertEqual(searchKey('Körperbeherrschung'), searchKey('koerperbeherrschung'));
  assertEqual(searchKey('Körperbeherrschung'), searchKey('KORPERBEHERRSCHUNG'));
  assertEqual(searchKey('Schlösser knacken'), searchKey('schloesser knacken'));
  assertEqual(searchKey('Straße'), 'strasse');
});

test(GROUP, 'Alle Proben: Eigenschaften, Talente, Kampf, Waffen, Zauber, Kampftechniken', () => {
  const choices = checkChoices(testHero());
  const mut = choices.find((choice) => choice.name === 'Mut');
  assertEqual([mut.chip, mut.spec], ['MU 14', { kind: 'attribute', code: 'MU' }]);
  const sinne = choices.find((choice) => choice.name === 'Sinnesschärfe');
  assertTrue(sinne.sub.includes('KL/IN/IN') && sinne.sub.includes('FW 7'), sinne.sub);
  assertEqual(sinne.spec, { kind: 'talent', id: 'sinnesschaerfe' });
  assertEqual(
    choices.filter((choice) => choice.group === 'Waffe').map((choice) => [choice.name, choice.spec.value]),
    [
      ['Langschwert AT', 'at'],
      ['Langschwert PA', 'pa'],
      ['Kurzbogen FK', 'fk'],
    ],
  );
  assertEqual(
    choices.filter((choice) => choice.spec.kind === 'spell').map((choice) => [choice.name, choice.group]),
    [
      ['Ignifaxius', 'Zauber'],
      ['Segen der Heiligen Noionitin', 'Liturgie'],
    ],
  );
  assertTrue(
    choices.some((choice) => choice.spec.kind === 'technique' && choice.spec.id === 'schwerter'),
    'Kampftechniken auch ohne Waffe',
  );
});

test(GROUP, 'Suche: Wortanfang zuerst, dann enthalten; Art der Probe findet auch', () => {
  const choices = checkChoices(testHero());
  const names = (query) => searchChecks(choices, query).map((choice) => choice.name);
  assertEqual(names('sinn')[0], 'Sinnesschärfe');
  assertEqual(names('körper').slice(0, 2), ['Körperkraft', 'Körperbeherrschung'], 'Eigenschaft, dann Talent');
  assertEqual(names('koerperb')[0], 'Körperbeherrschung', 'oe statt ö');
  assertEqual(names('wunden')[0], 'Heilkunde Wunden', 'zweites Wort');
  assertTrue(names('knacken').includes('Schlösserknacken'), 'mitten im Wort');
  assertEqual(names('igni'), ['Ignifaxius']);
  assertTrue(names('liturgie').includes('Segen der Heiligen Noionitin'), 'nach Art');
  assertEqual(names('   '), [], 'leer');
  assertEqual(names('xyz'), []);
  assertTrue(searchChecks(choices, 'e').length <= 12, 'höchstens 12 Treffer');
});

test(GROUP, 'Zuletzt gewürfelt: neueste zuerst, ohne Doppelte, nur was es beim Helden gibt', () => {
  let recent = [];
  recent = rememberRecent(recent, { kind: 'talent', id: 'sinnesschaerfe' });
  recent = rememberRecent(recent, { kind: 'dodge' });
  recent = rememberRecent(recent, { kind: 'talent', id: 'sinnesschaerfe' });
  assertEqual(recent, ['talent:sinnesschaerfe:', 'dodge::']);
  recent = rememberRecent(recent, { kind: 'spell', id: 'gibt-es-nicht' });
  const shown = recentChoices(checkChoices(testHero()), recent).map((choice) => choice.name);
  assertEqual(shown, ['Sinnesschärfe', 'Ausweichen']);
  for (let i = 0; i < 10; i += 1) recent = rememberRecent(recent, { kind: 'attribute', code: `X${i}` });
  assertEqual(recent.length, MAX_RECENT);
  assertEqual(specKey({ kind: 'weapon', id: 'w1', value: 'at' }), 'weapon:w1:at');
});

test(GROUP, 'Vollständige Liste: Eigenschaften, Kampf, alle Talente nach Gruppen, Zauber, Kampftechniken', () => {
  const sections = checkSections(testHero());
  assertEqual(
    sections.map((section) => section.title),
    [
      'Eigenschaften',
      'Kampf',
      'Talente: Körper',
      'Talente: Gesellschaft',
      'Talente: Natur',
      'Talente: Wissen',
      'Talente: Handwerk',
      'Zauber & Liturgien',
      'Kampftechniken',
    ],
  );
  const talents = sections.filter((section) => section.id !== 'eigenschaften' && section.title.startsWith('Talente'));
  assertEqual(
    talents.reduce((sum, section) => sum + section.choices.length, 0),
    59,
    'alle 59 Talente',
  );
  const sinne = sections.find((section) => section.id === 'koerper').choices.find((c) => c.name === 'Sinnesschärfe');
  assertEqual(sinne.value, 'FW 7', 'Wert für die Liste');
  assertEqual(sections[0].choices[0].value, 'MU 14');
  const ohneZauber = checkSections({ ...testHero(), spells: [] }).map((section) => section.id);
  assertTrue(!ohneZauber.includes('magie'), 'ohne Zauber kein leerer Abschnitt');
});

test(GROUP, 'Favoriten: an- und abwählen, in gemerkter Reihenfolge, Unbekanntes fällt weg', () => {
  let favorites = [];
  favorites = toggleKey(favorites, 'weapon:w1:at');
  favorites = toggleKey(favorites, 'dodge::');
  favorites = toggleKey(favorites, 'spell:weg:');
  assertEqual(favorites, ['weapon:w1:at', 'dodge::', 'spell:weg:']);
  assertEqual(toggleKey(favorites, 'dodge::'), ['weapon:w1:at', 'spell:weg:'], 'nochmal = abwählen');
  assertEqual(toggleKey(undefined, 'dodge::'), ['dodge::']);
  assertEqual(
    choicesByKeys(checkChoices(testHero()), favorites).map((choice) => choice.name),
    ['Langschwert AT', 'Ausweichen'],
  );
});
