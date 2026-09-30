/**
 * optolith.test.js – Import aus Optolith: MapTool-Token (.rptok), Heldendatei (.json), beide
 * zusammen, ZIP-Leser und Dateierkennung. Die Beispieldaten sind im Format von Optolith 1.5
 * nachgebaut (gekürzt).
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  heroFromOptolith,
  parseMapToolToken,
  isOptolithJson,
  convertDamage,
  damageBonus,
  withLevel,
  nameKey,
} from '../js/optolith.js';
import { readHeroFiles } from '../js/hero-files.js';
import { listZipEntries, readZipEntry, isZip } from '../js/zip.js';
import { exportHero, createHero } from '../js/sheet.js';

// ---------------------------------------------------------------------------
// Beispieldaten
// ---------------------------------------------------------------------------

const xmlEscape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Baut ein content.xml wie Optolith (Werte als Text; JSON-Werte werden eingebettet). */
function tokenXml(name, properties) {
  const entries = Object.entries(properties)
    .map(
      ([key, value]) =>
        `<entry><string>${key.toLowerCase()}</string><net.rptools.CaseInsensitiveHashMap_-KeyValue>` +
        `<key>${key}</key><value class="string">${xmlEscape(typeof value === 'string' ? value : JSON.stringify(value))}</value>` +
        `<outer-class reference="../../../.."/></net.rptools.CaseInsensitiveHashMap_-KeyValue></entry>`,
    )
    .join('');
  return (
    `<?xml version="1.0"?><net.rptools.maptool.model.Token><imageAssetMap/><name>${xmlEscape(name)}</name>` +
    `<tokenType>PC</tokenType><propertyMapCI><store>${entries}</store></propertyMapCI></net.rptools.maptool.model.Token>`
  );
}

const MAGE_TOKEN = {
  MU: '12',
  KL: '15',
  IN: '14',
  CH: '13',
  FF: '11',
  GE: '12',
  KO: '11',
  KK: '16',
  LeP: '24',
  MaxLeP: '27',
  AsP: '30',
  MaxAsP: '35',
  SchipsAktuell: '2',
  SchipsMax: '3',
  SK: '2',
  ZK: '0',
  INI: '14',
  GS: '8',
  AW: '7',
  APgesamt: '1150',
  APausgegeben: '1080',
  Exporter: '1.5.2',
  Koerper: [
    { Talent: 'Klettern', Talentwert: 3, Probe: { Eigenschaft1: 'MU', Eigenschaft2: 'GE', Eigenschaft3: 'KK' } },
    { Talent: 'Fliegen', Talentwert: 0, Probe: { Eigenschaft1: 'MU', Eigenschaft2: 'IN', Eigenschaft3: 'GE' } },
  ],
  Gesellschaft: [
    {
      Talent: 'Bekehren & Überzeugen',
      Talentwert: 4,
      Probe: { Eigenschaft1: 'MU', Eigenschaft2: 'KL', Eigenschaft3: 'CH' },
    },
  ],
  Natur: [],
  Wissen: [
    { Talent: 'Magiekunde', Talentwert: 12, Probe: { Eigenschaft1: 'KL', Eigenschaft2: 'KL', Eigenschaft3: 'IN' } },
    { Talent: 'Drachenkunde', Talentwert: 5, Probe: { Eigenschaft1: 'KL', Eigenschaft2: 'KL', Eigenschaft3: 'IN' } },
  ],
  Handwerk: [],
  Zauber: [
    {
      Talent: 'Ignifaxius',
      Talentwert: 9,
      Probe: { Eigenschaft1: 'MU', Eigenschaft2: 'KL', Eigenschaft3: 'CH' },
      Merkmal: 'Elementar',
    },
  ],
  Rituale: [
    {
      Talent: 'Stabbindung',
      Talentwert: 4,
      Probe: { Eigenschaft1: 'KL', Eigenschaft2: 'IN', Eigenschaft3: 'FF' },
      Merkmal: 'Objekt',
    },
  ],
  Vorteile: [
    { Name: 'Zauberer', Stufe: 0 },
    { Name: 'Hohe Astralkraft', Stufe: 2 },
    { Name: 'Eigener Vorteil (Glückspilz beim Kartenspiel)', Stufe: 0 },
  ],
  Nachteile: [{ Name: 'Arroganz', Stufe: 0 }],
  AllgemeineSF: [
    { Name: 'Sprache (Garethi)', Stufe: 4 },
    { Name: 'Sprache (Bosparano)', Stufe: 2 },
    { Name: 'Schrift (Kusliker Zeichen)', Stufe: 0 },
    { Name: 'Berufsgeheimnis (Zauberstab)', Stufe: 0 },
    { Name: 'Fertigkeitsspezialisierung (Magiekunde: Artefakte)', Stufe: 0 },
    { Name: 'Fertigkeitsspezialisierung (Magiekunde: Zauberwerke)', Stufe: 0 },
    { Name: 'Ortskenntnis (Punin)', Stufe: 0 },
  ],
  MagieSF: [{ Name: 'Tradition (Gildenmagier)', Stufe: 0 }],
  KampfSF: [{ Name: 'Kampfreflexe', Stufe: 2 }],
  KlerikaleSF: [],
  Kampftechniken: [
    { Name: 'Stangenwaffen', FW: 10, L: ['GE', 'KK'] },
    { Name: 'Dolche', FW: 6, L: ['GE'] },
    { Name: 'Feuerspeien', FW: 8, L: ['FF'] },
  ],
  Nahkampfwaffen: [
    {
      ID: 1,
      Name: 'Magierstab',
      Technik: 'Stangenwaffen',
      TP: '1d6+2',
      RW: 3,
      AT: 0,
      PA: 2,
      LS: [
        { L: 'GE', S: 15 },
        { L: 'KK', S: 15 },
      ],
      Zweihand: 1,
    },
    { ID: 2, Name: 'Dolch', Technik: 'Dolche', TP: '1d6+1', RW: 1, AT: 0, PA: 0, LS: [{ L: 'GE', S: 14 }] },
  ],
  Fernkampfwaffen: [
    { ID: 0, Name: 'Kurzbogen', Technik: 'Bögen', TP: '1d6+4', RW1: 10, RW2: 50, RW3: 80, Ladezeit: 1 },
  ],
  Ruestungen: [
    { ID: 0, Name: 'Keine Rüstung', RS: 0, BE: 0 },
    { ID: 1, Name: 'Lederharnisch', RS: 3, BE: 1 },
    { ID: 2, Name: 'Gambeson', RS: 2, BE: 1 },
  ],
  InventarMisc: { dukaten: 3, silbertaler: 7, heller: 0, kreuzer: 12 },
  Inventar: [
    { gegenstand: 'Zauberstab', anzahl: 1, gewicht: 1, behaelter: 1 },
    { gegenstand: 'Proviant für 1 Tag', anzahl: 5, gewicht: 1.5, behaelter: 1 },
  ],
};

const DWARF_JSON = {
  clientVersion: '1.5.2',
  id: 'H_1',
  name: 'Ingrimosch',
  sex: 'm',
  el: 'EL_3',
  r: 'R_4',
  c: 'C_12',
  p: 'P_0',
  professionName: 'Schmied',
  ap: { total: 1100 },
  pers: { family: 'Sohn des Angrax', age: '87', size: '138', haircolor: 5, socialstatus: 2, title: 'Meister' },
  attr: {
    values: [
      { id: 'ATTR_1', value: 13 },
      { id: 'ATTR_2', value: 11 },
      { id: 'ATTR_3', value: 12 },
      { id: 'ATTR_4', value: 10 },
      { id: 'ATTR_5', value: 13 },
      { id: 'ATTR_6', value: 11 },
      { id: 'ATTR_7', value: 15 },
      { id: 'ATTR_8', value: 16 },
    ],
    lp: 2,
    ae: 0,
    kp: 0,
    permanentLP: { lost: 1 },
  },
  activatable: {
    ADV_4: [{ sid: 'TAL_55' }],
    DISADV_0: [{ sid: 'Angst vor Wasser', cost: 5 }],
    DISADV_5: [],
    SA_29: [
      { sid: 1, tier: 4 },
      { sid: 7, tier: 2 },
    ],
  },
  talents: { TAL_5: 7, TAL_55: 12, TAL_46: 3 },
  ct: { CT_15: 11, CT_17: 9 },
  spells: {},
  cantrips: [],
  liturgies: {},
  blessings: ['BLESSING_1', 'BLESSING_3'],
  belongings: {
    items: {
      ITEM_1: {
        id: 'ITEM_1',
        name: 'Felsspalter',
        gr: 1,
        amount: 1,
        weight: 3,
        combatTechnique: 'CT_15',
        damageDiceNumber: 2,
        damageDiceSides: 6,
        damageFlat: 2,
        at: 0,
        pa: -2,
        reach: 2,
        primaryThreshold: { threshold: 14 },
      },
      ITEM_2: { id: 'ITEM_2', name: 'Kettenhemd', gr: 4, amount: 1, weight: 10, pro: 4, enc: 2 },
      ITEM_3: { id: 'ITEM_3', name: 'Pony', gr: 25, amount: 1 },
      ITEM_4: { id: 'ITEM_4', name: 'Fackel', gr: 8, amount: 3, weight: 0.5 },
    },
    purse: { d: '2', s: '', h: '5', k: '0' },
  },
};

const talent = (hero, id) => hero.talents.find((entry) => entry.id === id);
const technique = (hero, id) => hero.combatTechniques.find((entry) => entry.id === id);
const texts = (list) => list.map((entry) => entry.text);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

test('Optolith: Hilfsfunktionen', 'Würfel umrechnen, Schadensbonus, Stufen, Namen vergleichen', () => {
  assertEqual(convertDamage('1d6+1'), '1W6+1');
  assertEqual(convertDamage('2d6+0'), '2W6', '+0 entfällt');
  assertEqual(convertDamage('1d6-1'), '1W6-1');
  assertEqual(convertDamage('1d6+2', 2), '1W6+4', 'mit Schadensbonus');
  assertEqual(damageBonus([{ L: 'KK', S: 14 }], { KK: 16 }), 2);
  assertEqual(
    damageBonus(
      [
        { L: 'GE', S: 15 },
        { L: 'KK', S: 15 },
      ],
      { GE: 17, KK: 12 },
    ),
    2,
    'beste Leiteigenschaft',
  );
  assertEqual(damageBonus([{ L: 'KK', S: 14 }], { KK: 12 }), 0, 'unter der Schwelle kein Abzug');
  assertEqual(withLevel('Reich', 3), 'Reich III');
  assertEqual(withLevel('Richtungssinn', 0), 'Richtungssinn');
  assertEqual(nameKey('Brett- & Glücksspiel'), nameKey('Brett-&Glucksspiel'));
  assertEqual(nameKey('Fährtensuchen'), 'fahrtensuchen');
});

test('Optolith: MapTool-Token', 'Eigenschaften lesen: Sonderzeichen, leere Werte, Name', () => {
  const xml =
    '<net.rptools.maptool.model.Token><name>Alrik &amp; Co</name><propertyMapCI><store>' +
    '<entry><key>Gesellschaft</key><value class="string">[{"Talent":"Bekehren &amp; Überzeugen"}]</value></entry>' +
    '<entry><key>Leer</key><value class="string"/></entry>' +
    '<entry><key>Zeile</key><value class="string">eins<br/>zwei &#252;ber</value></entry>' +
    '</store></propertyMapCI></net.rptools.maptool.model.Token>';
  const token = parseMapToolToken(xml);
  assertEqual(token.name, 'Alrik & Co');
  assertEqual(JSON.parse(token.properties.get('Gesellschaft'))[0].Talent, 'Bekehren & Überzeugen');
  assertEqual(token.properties.get('Leer'), '');
  assertEqual(token.properties.get('Zeile'), 'eins zwei über');
});

// ---------------------------------------------------------------------------
// Nur MapTool-Token
// ---------------------------------------------------------------------------

test('Optolith: MapTool-Token', 'Grundwerte, Talente mit Probe, Spezialisierungen', () => {
  const { hero } = heroFromOptolith({ token: parseMapToolToken(tokenXml('Rohezal', MAGE_TOKEN)) });
  assertEqual(hero.general.name, 'Rohezal');
  assertEqual([hero.general.apTotal, hero.general.apSpent, hero.general.experience], [1150, 1080, 'Erfahren']);
  assertEqual(hero.attributes, { MU: 12, KL: 15, IN: 14, CH: 13, FF: 11, GE: 12, KO: 11, KK: 16 });
  assertEqual(hero.base.le, { current: 24, max: 27 });
  assertEqual(hero.base.asp, { current: 30, max: 35 });
  assertEqual(hero.base.kap, { current: 0, max: 0 });
  assertEqual(hero.base.schip, { current: 2, max: 3 });
  assertEqual([hero.base.sk, hero.base.zk, hero.base.gs], [2, 0, 8]);
  assertEqual(hero.base.aw, 7, 'AW weicht von GE/2 ab → fest eingetragen');
  assertEqual(hero.base.ini, 14, 'INI weicht ab (z. B. Kampfreflexe) → fest eingetragen');
  assertEqual(talent(hero, 'klettern').fw, 3);
  assertEqual(talent(hero, 'bekehren').fw, 4, 'Name mit „&“');
  assertEqual(talent(hero, 'magiekunde').spec, 'Artefakte, Zauberwerke');
});

test('Optolith: MapTool-Token', 'Vorteile, Nachteile, SF, Sprachen, Schriften, Berufsgeheimnisse', () => {
  const { hero } = heroFromOptolith({ token: parseMapToolToken(tokenXml('Rohezal', MAGE_TOKEN)) });
  assertEqual(texts(hero.advantages), ['Zauberer', 'Hohe Astralkraft II', 'Glückspilz beim Kartenspiel']);
  assertEqual(texts(hero.disadvantages), ['Arroganz']);
  assertEqual(texts(hero.specialAbilities), ['Ortskenntnis (Punin)', 'Kampfreflexe II', 'Tradition (Gildenmagier)']);
  assertEqual(texts(hero.languages), ['Garethi (Muttersprache)', 'Bosparano II', 'Schrift: Kusliker Zeichen']);
  assertEqual(texts(hero.tradeSecrets), ['Zauberstab']);
});

test('Optolith: MapTool-Token', 'Zauber und Rituale, Kampftechniken, Waffen, Rüstung, Inventar, Geld', () => {
  const { hero, report } = heroFromOptolith({ token: parseMapToolToken(tokenXml('Rohezal', MAGE_TOKEN)) });
  const [ignifaxius, stab] = hero.spells;
  assertEqual(
    [ignifaxius.name, ignifaxius.type, ignifaxius.fw, ignifaxius.check],
    ['Ignifaxius', 'zauber', 9, ['MU', 'KL', 'CH']],
  );
  assertEqual(ignifaxius.note, 'Merkmal: Elementar');
  assertEqual([stab.name, stab.type], ['Stabbindung', 'ritual']);
  assertEqual(technique(hero, 'stangenwaffen').ktw, 10);
  assertTrue(hero.general.notes.includes('Feuerspeien 8'), 'unbekannte Kampftechnik in den Notizen');
  const [staff, dagger, bow] = hero.weapons;
  assertEqual(
    [staff.name, staff.technique, staff.tp, staff.paMod, staff.range],
    ['Magierstab', 'stangenwaffen', '1W6+3', 2, 'lang'],
  );
  assertEqual(dagger.tp, '1W6+1', 'GE 12 unter der Schwelle 14');
  assertEqual([bow.technique, bow.tp, bow.range], ['boegen', '1W6+4', '10/50/80 · Ladezeit 1']);
  assertEqual(hero.armor, { name: 'Lederharnisch', rs: 3, be: 1 });
  assertTrue(
    report.todo.some((line) => line.includes('Mehrere Rüstungen')),
    'Hinweis auf weitere Rüstung',
  );
  assertEqual(
    hero.inventory.map((item) => [item.name, item.count, item.weight, item.location]),
    [
      ['Zauberstab', 1, 1, 'koerper'],
      ['Proviant für 1 Tag', 5, 1.5, 'koerper'],
    ],
  );
  assertEqual(hero.money, { dukaten: 3, silbertaler: 7, heller: 0, kreuzer: 12 });
  assertTrue(
    report.todo.some((line) => line.includes('Drachenkunde 5')),
    'unbekanntes Talent gemeldet',
  );
  assertTrue(
    report.todo.some((line) => line.includes('Spezies')),
    'Spezies fehlt ohne JSON',
  );
});

test('Optolith: MapTool-Token', 'Kaputter Abschnitt wird gemeldet, der Rest trotzdem übernommen', () => {
  const broken = tokenXml('Kaputt', { ...MAGE_TOKEN, Vorteile: '[{"Name":"Zitat "Ohne" Maskierung"}]' });
  const { hero, report } = heroFromOptolith({ token: parseMapToolToken(broken) });
  assertEqual(hero.advantages, []);
  assertTrue(
    report.todo.some((line) => line.includes('„Vorteile“')),
    report.todo.join(' / '),
  );
  assertEqual(talent(hero, 'magiekunde').fw, 12);
});

// ---------------------------------------------------------------------------
// Nur Optolith-Heldendatei
// ---------------------------------------------------------------------------

test('Optolith: Heldendatei (JSON)', 'Erkennung, Werte über Optoliths Nummern, persönliche Daten', () => {
  assertTrue(isOptolithJson(DWARF_JSON));
  assertTrue(!isOptolithJson({ format: 'dsa5-held', hero: {} }), 'eigene Sicherung ist kein Optolith');
  const { hero } = heroFromOptolith({ json: DWARF_JSON });
  assertEqual([hero.general.name, hero.general.species, hero.general.profession], ['Ingrimosch', 'Zwerge', 'Schmied']);
  assertEqual(hero.general.experience, 'Erfahren');
  assertEqual(hero.attributes.KK, 16);
  assertEqual(
    [talent(hero, 'kraftakt').fw, talent(hero, 'metallbearbeitung').fw, talent(hero, 'handel').fw],
    [7, 12, 3],
  );
  assertEqual(technique(hero, 'zweihandhiebwaffen').ktw, 11);
  assertTrue(hero.general.notes.includes('Feuerspeien 9'), 'Kampftechnik ohne Gegenstück in den Notizen');
  assertTrue(hero.general.notes.includes('Familie: Sohn des Angrax'), hero.general.notes);
  assertTrue(hero.general.notes.includes('Sozialstatus: Frei'));
  assertEqual(hero.general.appearance, 'Alter: 87 · Größe: 138');
});

test('Optolith: Heldendatei (JSON)', 'Grundwerte aus Spezies berechnet, Hinweise auf Fehlendes', () => {
  const { hero, report } = heroFromOptolith({ json: DWARF_JSON });
  // Zwerge: LE 8 + 2 × KO 15 + 2 gekauft − 1 verloren = 39; SK −4 + (13+11+12)/6 = 2; ZK −4 + (15+15+16)/6 ≈ 4
  assertEqual(hero.base.le, { current: 39, max: 39 });
  assertEqual([hero.base.sk, hero.base.zk, hero.base.gs], [2, 4, 6]);
  assertEqual(texts(hero.disadvantages), ['Angst vor Wasser'], 'eigene Einträge mit Namen');
  assertTrue(
    report.todo.some((line) => line.includes('1 Vorteile') && line.includes('2 Sonderfertigkeiten')),
    report.todo.join(' / '),
  );
  assertTrue(
    report.todo.some((line) => line.includes('2 Segnungen')),
    'Segnungen gemeldet',
  );
  assertTrue(report.todo.some((line) => line.includes('AP ausgegeben')));
});

test('Optolith: Heldendatei (JSON)', 'Waffen mit Schadensbonus, Rüstung, Inventar mit Orten, Geld', () => {
  const { hero } = heroFromOptolith({ json: DWARF_JSON });
  assertEqual(
    hero.weapons.map((weapon) => [weapon.name, weapon.technique, weapon.tp, weapon.paMod, weapon.range]),
    [['Felsspalter', 'zweihandhiebwaffen', '2W6+4', -2, 'mittel']],
  );
  assertEqual(hero.armor, { name: 'Kettenhemd', rs: 4, be: 2 });
  assertEqual(
    hero.inventory.map((item) => [item.name, item.location]),
    [
      ['Felsspalter', 'koerper'],
      ['Kettenhemd', 'koerper'],
      ['Pony', 'packtier'],
      ['Fackel', 'koerper'],
    ],
  );
  assertEqual(hero.money, { dukaten: 2, silbertaler: 0, heller: 5, kreuzer: 0 });
});

// ---------------------------------------------------------------------------
// Beide zusammen, Dateien, ZIP
// ---------------------------------------------------------------------------

test('Optolith: beide Dateien', 'Namen und Grundwerte aus dem Token, Spezies und Daten aus der JSON', () => {
  const token = parseMapToolToken(tokenXml('Ingrimosch', MAGE_TOKEN));
  const { hero, report } = heroFromOptolith({ json: DWARF_JSON, token });
  assertEqual(hero.general.species, 'Zwerge');
  assertEqual(hero.base.le, { current: 24, max: 27 }, 'Grundwerte aus dem Token');
  assertEqual(texts(hero.advantages)[0], 'Zauberer', 'Namen aus dem Token');
  assertEqual(hero.inventory.find((item) => item.name === 'Pony').location, 'packtier', 'Inventar aus der JSON');
  assertTrue(!report.todo.some((line) => line.includes('AP ausgegeben')));
});

/** Kleines ZIP-Archiv im Speicher (optional mit deflate-Kompression). */
async function makeZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, text, deflate } of files) {
    const raw = encoder.encode(text);
    const data = deflate
      ? new Uint8Array(
          await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
        )
      : raw;
    const nameBytes = encoder.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, deflate ? 8 : 0, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    directory.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)]);
}

test('Optolith: Dateien', 'ZIP lesen: unkomprimiert und komprimiert', async () => {
  const blob = await makeZip([
    { name: 'assets/', text: '' },
    { name: 'properties.xml', text: '<map/>' },
    { name: 'content.xml', text: 'Hallo Aventurien – äöü '.repeat(50), deflate: true },
  ]);
  const buffer = await blob.arrayBuffer();
  assertTrue(isZip(new Uint8Array(buffer)));
  assertEqual(
    listZipEntries(buffer).map((entry) => entry.name),
    ['assets/', 'properties.xml', 'content.xml'],
  );
  assertEqual(new TextDecoder().decode(await readZipEntry(buffer, 'properties.xml')), '<map/>');
  assertEqual(
    new TextDecoder().decode(await readZipEntry(buffer, 'content.xml')),
    'Hallo Aventurien – äöü '.repeat(50),
  );
  assertEqual(await readZipEntry(buffer, 'fehlt.xml'), null);
});

test(
  'Optolith: Dateien',
  'Dateien erkennen: .rptok + .json zusammen, Sicherung, PDF, falsche Kombinationen',
  async () => {
    const rptok = new File(
      [await makeZip([{ name: 'content.xml', text: tokenXml('Ingrimosch', MAGE_TOKEN), deflate: true }])],
      'Ingrimosch.rptok',
    );
    const json = new File([JSON.stringify(DWARF_JSON)], 'Ingrimosch.json');
    const both = await readHeroFiles([rptok, json]);
    assertEqual([both.hero.general.name, both.hero.general.species], ['Ingrimosch', 'Zwerge']);
    assertTrue(both.report.imported.length > 0, 'Bericht vorhanden');

    const backupHero = createHero();
    backupHero.general.name = 'Sicherung';
    const backup = await readHeroFiles([new File([exportHero(backupHero)], 'sicherung.json')]);
    assertEqual([backup.hero.general.name, backup.report], ['Sicherung', null]);

    const failures = [];
    const expectError = async (files, fragment, label) => {
      try {
        await readHeroFiles(files);
        failures.push(`${label}: kein Fehler`);
      } catch (error) {
        if (!error.message.includes(fragment)) failures.push(`${label}: ${error.message}`);
      }
    };
    await expectError([new File(['%PDF-1.7 …'], 'held.pdf')], 'PDF', 'PDF');
    await expectError([new File(['kein json'], 'x.json')], 'weder', 'Unsinn');
    await expectError(
      [new File([exportHero(backupHero)], 'a.json'), json],
      'nur eine Sicherungsdatei',
      'Sicherung + Optolith',
    );
    const other = new File(
      [await makeZip([{ name: 'content.xml', text: tokenXml('Rohezal', MAGE_TOKEN) }])],
      'Rohezal.rptok',
    );
    await expectError([other, json], 'verschiedenen Helden', 'zwei Helden');
    await expectError(
      [new File([await makeZip([{ name: 'bild.png', text: 'x' }])], 'x.rptok')],
      'kein Held aus Optolith',
      'ZIP ohne Token',
    );
    assertEqual(failures, []);
  },
);
