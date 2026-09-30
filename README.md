# DSA5 am Spieltisch

Web-App, mit der eine Gruppe „Das Schwarze Auge 5“ online und unterwegs am Handy spielen kann:
Helden vollständig eintragen, Proben direkt aus dem Heldenbogen würfeln, alles live für alle synchronisiert.

- Vanilla HTML, CSS und JavaScript (ES-Module), **kein Build-Schritt** – läuft direkt auf GitHub Pages.
- Backend: Supabase (Datenbank, Realtime, anonyme Anmeldung).

## Stand der Entwicklung

| Phase | Inhalt                                                                 | Status    |
| ----- | ---------------------------------------------------------------------- | --------- |
| 1     | Dateistruktur, Regel-Logik (`rules.js`), Würfel (`dice.js`), Testseite | ✅ fertig |
| 2     | Heldenbogen lokal (noch ohne Server)                                   | ✅ fertig |
| 3     | Supabase: SQL, Räume, Rollen, Sync                                     | offen     |
| 4     | Würfelprotokoll, Meister-Ansicht, Initiative                           | offen     |
| 5     | Mobile-Feinschliff, PWA                                                | offen     |

Die vollständige Einrichtungsanleitung (Supabase-Projekt anlegen, SQL ausführen, Keys eintragen,
auf GitHub Pages veröffentlichen) kommt mit Phase 3 in diese Datei.

## App lokal starten

ES-Module laden nicht über `file://`. Deshalb die App über einen einfachen Webserver öffnen:

```bash
# im Projektordner
python3 -m http.server 8000
```

Dann im Browser <http://localhost:8000/> öffnen. Bis Phase 3 wird der Held nur im Browser dieses
Geräts gespeichert (localStorage). Über das Menü (⋮ oben rechts) lässt er sich als JSON-Datei
exportieren und wieder importieren.

## Bedienung

- **Held:** Alle Bereiche lassen sich auf- und zuklappen (merkt sich das Gerät). Änderungen werden
  nach ca. 0,8 Sekunden gespeichert; oben steht „wird gespeichert …“ bzw. „gespeichert“.
- **Proben:** Ein Tipp auf eine Eigenschaft, ein Talent, einen Zauber, AT/PA/FK, Ausweichen oder
  Initiative öffnet den Probendialog mit Erleichterung/Erschwernis. Zustände werden automatisch
  eingerechnet (im Dialog abschaltbar). Das Ergebnis zeigt jeden Würfel, den Zielwert und die Rest-FP.
- **Schicksalspunkt:** Im Ergebnis „Schicksalspunkt einsetzen“ tippen, Würfel auswählen, neu werfen.
- **Zauber & Liturgien:** Die Kosten (erste Zahl aus „Kosten“) werden nach der Probe von AsP bzw. KaP
  abgezogen – mit „Rückgängig“-Knopf.
- **Waffen:** Knöpfe für AT, PA (bzw. FK) und TP. Nach einer gelungenen Attacke gibt es direkt
  „Schaden würfeln“, bei kritischem Treffer verdoppelt.
- **Stift-Symbol:** öffnet die Bearbeitung eines Eintrags (Probeneigenschaften, Spezialisierung, Waffendaten …).
- **Leere Felder bei AW, INI und Kampfwerten** bedeuten „automatisch berechnen“; ein eingetragener Wert hat Vorrang.
- **Würfeln:** freie Ausdrücke wie `2W6+3`, `1W20`, `3W20` sowie Schnellzugriff auf Eigenschaften und Waffen.
- **Protokoll:** alle Würfe mit Heldennamen und Uhrzeit, zum Aufklappen mit allen Einzelwürfeln.
- **Menü:** Export/Import, neuer Held, Hell-/Dunkel-/Automatik-Modus.

## Dateistruktur

```
index.html               Einstieg der App
css/style.css            Gestaltung (mobile-first, Hell/Dunkel)
js/app.js                Start: Kopfzeile, Tab-Leiste, Ansichten, Speichern
js/rules.js              Reine DSA5-Regel-Logik (kein DOM, kein Zufall)
js/dice.js               Würfeln mit crypto.getRandomValues, Würfelausdrücke wie 2W6+3
js/data/talents.js       Stammdaten: 59 Talente, Kampftechniken, Zauberarten
js/sheet.js              Heldenmodell: Standardheld, Reparieren, Export/Import, abgeleitete Werte
js/checks.js             Proben ausführen (Held + Würfel + Regeln → Protokolleintrag), Schicksalspunkte
js/format.js             Texte für Ergebnisse und Modifikatoren
js/store.js              Hält den Helden und meldet Änderungen an die Ansichten
js/saver.js              Speichern mit Verzögerung (Debounce) und Statusanzeige
js/log.js                Würfelprotokoll dieses Geräts
js/storage.js            Sicherer Zugriff auf localStorage
js/util.js               Allgemeine Hilfsfunktionen
js/ui/dom.js             Sicheres Erzeugen von Elementen (nie innerHTML mit Nutzerdaten)
js/ui/fields.js          An den Helden gebundene Eingabefelder
js/ui/dialog.js          Dialoge (am Handy als Blatt von unten)
js/ui/toast.js           Meldungen, auch Fehler und „Rückgängig“
js/ui/check-dialog.js    Probendialog
js/ui/roll-view.js       Darstellung von Würfen (Dialog und Protokoll)
js/ui/roll-actions.js    Würfelknöpfe → Probenbeschreibung
js/ui/dice-view.js       Tab „Würfeln“
js/ui/log-view.js        Tab „Protokoll“
js/ui/menu.js            Menü (Export/Import, neuer Held, Darstellung)
js/ui/theme.js           Hell-/Dunkelmodus
js/ui/sheet/*.js         Heldenbogen: Bereiche, berechnete Anzeigen, Steuerung
tests/rules.test.html    Testseite – prüft alles automatisch
tests/*.test.js          Testfälle (Regeln & Würfel, Heldenmodell & Proben)
```

Noch geplant: `js/room.js`, `js/sync.js`, `supabase/schema.sql` (Phase 3), Meister-Ansicht (Phase 4),
`manifest.webmanifest` und `sw.js` (Phase 5).

## Tests ausführen

Webserver wie oben starten und <http://localhost:8000/tests/rules.test.html> öffnen. Die Seite zeigt oben
„Alle … Tests bestanden ✓“ oder listet fehlgeschlagene Tests rot mit erwartetem und erhaltenem Wert.
Nach der Veröffentlichung auf GitHub Pages ist dieselbe Seite unter `…/tests/rules.test.html` erreichbar.

Die fünf Pflicht-Testfälle aus der Aufgabenstellung stehen als eigene Gruppe ganz oben.

## Regelentscheidungen

Diese Punkte sind in `js/rules.js` bzw. `js/checks.js` umgesetzt. Falls eure Runde es anders spielt, lässt sich das
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
- **Spezialisierung:** Eine passende Fertigkeitsspezialisierung erhöht den FW um 2 (im Probendialog wählbar).
- **Initiative:** INI-Basis + 1W6. Bei Gleichstand zuerst der höhere INI-Basiswert, dann ein Stechwurf.
- **Zufall:** ausschließlich `crypto.getRandomValues` mit Verwerfungsverfahren, damit alle Seiten
  eines Würfels exakt gleich wahrscheinlich sind.
