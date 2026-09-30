# DSA5 am Spieltisch

Web-App, mit der eine Gruppe „Das Schwarze Auge 5“ online und unterwegs am Handy spielen kann:
Helden vollständig eintragen, Proben direkt aus dem Heldenbogen würfeln, alles live für alle synchronisiert.

- Vanilla HTML, CSS und JavaScript (ES-Module), **kein Build-Schritt** – läuft direkt auf GitHub Pages.
- Backend: Supabase (Datenbank, Realtime, anonyme Anmeldung).

## Stand der Entwicklung

| Phase | Inhalt                                                                 | Status    |
| ----- | ---------------------------------------------------------------------- | --------- |
| 1     | Dateistruktur, Regel-Logik (`rules.js`), Würfel (`dice.js`), Testseite | ✅ fertig |
| 2     | Heldenbogen lokal (noch ohne Server)                                   | offen     |
| 3     | Supabase: SQL, Räume, Rollen, Sync                                     | offen     |
| 4     | Würfelprotokoll, Meister-Ansicht, Initiative                           | offen     |
| 5     | Mobile-Feinschliff, PWA                                                | offen     |

Die vollständige Einrichtungsanleitung (Supabase-Projekt anlegen, SQL ausführen, Keys eintragen,
auf GitHub Pages veröffentlichen) kommt mit Phase 3 in diese Datei.

## Dateistruktur

Bereits vorhanden:

```
js/rules.js            Reine DSA5-Regel-Logik (kein DOM, kein Zufall)
js/dice.js             Würfeln mit crypto.getRandomValues, Würfelausdrücke wie 2W6+3
tests/rules.test.html  Testseite – prüft rules.js und dice.js automatisch
tests/rules.test.js    Die Testfälle
tests/harness.js       Kleines Testwerkzeug für die Testseite
```

Geplant für die folgenden Phasen:

```
index.html             Einstieg der App
css/style.css          Gestaltung (mobile-first, Hell/Dunkel)
js/app.js              Start, Navigation, Tab-Leiste
js/data/talents.js     DSA5-Talente und Kampftechniken
js/sheet.js            Heldenmodell: Standardwerte, Export/Import
js/checks.js           Proben ausführen (Heldenbogen + Würfel + Regeln → Protokolleintrag)
js/room.js             Räume erstellen/beitreten, Meister-PIN, Rollen
js/sync.js             Supabase, Speichern mit Debounce, Realtime, Offline-Warteschlange
js/ui/*.js             Oberflächen-Module (Heldenbogen, Probendialog, Protokoll, Gruppe …)
supabase/schema.sql    Tabellen und Row Level Security
manifest.webmanifest   PWA-Manifest
sw.js                  Service Worker (offline lesbar)
```

## Tests ausführen

ES-Module laden nicht über `file://`. Deshalb die Seite über einen einfachen Webserver öffnen:

```bash
# im Projektordner
python3 -m http.server 8000
```

Dann im Browser <http://localhost:8000/tests/rules.test.html> öffnen. Die Seite zeigt oben
„Alle … Tests bestanden ✓“ oder listet fehlgeschlagene Tests rot mit erwartetem und erhaltenem Wert.
Nach der Veröffentlichung auf GitHub Pages ist dieselbe Seite unter `…/tests/rules.test.html` erreichbar.

Die fünf Pflicht-Testfälle aus der Aufgabenstellung stehen als eigene Gruppe ganz oben.

## Regelentscheidungen

Diese Punkte sind in `js/rules.js` umgesetzt. Falls eure Runde es anders spielt, lässt sich das
jeweils an einer Stelle ändern:

- **Modifikatoren:** positiv = Erleichterung, negativ = Erschwernis. Bei Fertigkeitsproben gilt der
  Modifikator für alle drei Eigenschaften.
- **Kritischer Erfolg (zwei 1er):** Die Probe gelingt immer, die QS ergibt sich aus den übrigen FP,
  mindestens aber QS 1. Drei 1er = spektakulärer Erfolg.
- **Patzer (zwei 20er):** Die Probe misslingt immer. Drei 20er = spektakulärer Patzer.
- **W20-Proben (Eigenschaft, AT, PA, Ausweichen, Fernkampf):** Eine 1 gelingt immer, eine 20 misslingt
  immer. Nach einer 1 bzw. 20 folgt ein Bestätigungswurf gegen denselben Wert: gelingt er nach einer 1 →
  kritischer Erfolg; misslingt er nach einer 20 → Patzer.
- **Zustände:** −1 je Stufe, einzeln abschaltbar, zusammen höchstens −5 (DSA5-Regel).
  Automatischer Schmerz aus LE (I ≤ ¾, II ≤ ½, III ≤ ¼, IV ≤ 5 LE) wird zu einem eingetragenen
  Schmerz (z. B. durch Gift) addiert, höchstens Stufe IV.
- **Schicksalspunkt (Neuwurf):** Ein, zwei oder alle Würfel einer Probe dürfen neu geworfen werden,
  das neue Ergebnis ist bindend. Nach einem Patzer ist kein Neuwurf möglich.
- **Zauber- und Liturgiekosten:** Bei gelungener Probe volle Kosten, bei misslungener die Hälfte
  (kaufmännisch gerundet, mindestens 1). Der Betrag lässt sich vor dem Abziehen noch anpassen.
- **Abgeleitete Kampfwerte (als Rechenhilfe):** AT = KtW + MU-Bonus, PA = KtW/2 (aufgerundet) + Bonus
  der besten Leiteigenschaft, FK = KtW + FF-Bonus, Bonus = +1 je volle 3 Punkte über 8.
  Ausweichen = GE/2, INI-Basis = (MU+GE)/2, jeweils kaufmännisch gerundet.
- **Initiative:** INI-Basis + 1W6. Bei Gleichstand zuerst der höhere INI-Basiswert, dann ein Stechwurf.
- **Zufall:** ausschließlich `crypto.getRandomValues` mit Verwerfungsverfahren, damit alle Seiten
  eines Würfels exakt gleich wahrscheinlich sind.
