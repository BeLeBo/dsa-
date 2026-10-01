# DSA5 am Spieltisch

Web-App, mit der eine Gruppe „Das Schwarze Auge 5“ online und unterwegs am Handy spielen kann:
Helden vollständig eintragen, Proben direkt aus dem Heldenbogen würfeln, gemeinsame Karte mit Figuren –
alles live für alle synchronisiert.

- Vanilla HTML, CSS und JavaScript (ES-Module), **kein Build-Schritt** – läuft direkt auf GitHub Pages.
- Backend: Supabase (Datenbank, Realtime, anonyme Anmeldung – keine E-Mail nötig).
- Ohne Server nutzbar: Modus „Ohne Raum spielen“ speichert den Helden nur auf dem Gerät.
- Als App auf dem Handy installierbar und offline startbar (PWA).

## Stand der Entwicklung

| Phase | Inhalt                                                                 | Status    |
| ----- | ---------------------------------------------------------------------- | --------- |
| 1     | Dateistruktur, Regel-Logik (`rules.js`), Würfel (`dice.js`), Testseite | ✅ fertig |
| 2     | Heldenbogen lokal (noch ohne Server)                                   | ✅ fertig |
| 3     | Supabase: SQL, Räume, Rollen, Sync                                     | ✅ fertig |
| 4     | Gemeinsames Würfelprotokoll, Meister-Ansicht, Initiative               | ✅ fertig |
| 5     | Mobile-Feinschliff, PWA (installierbar, offline startbar)              | ✅ fertig |
| 6     | Karte mit Figuren (hochladen, Raster, Drag & Drop, live)               | ✅ fertig |
| 7     | Optolith-Import, Mehrfachauswahl und Werte-Panel auf der Karte         | ✅ fertig |
| 8     | Ohne Meister-PIN, LeP für Gegner, Proben und Werte auf der Karte       | ✅ fertig |
| 9     | Lebensbalken: Helden genau, Gegner in Vierteln                         | ✅ fertig |
| 10    | Spielbildschirm (Werte/Proben), eigene Figur, Karten-Tabs des Meisters | ✅ fertig |
| 11    | Kampf und letzte Würfe im Spielbildschirm, Favoriten                   | ✅ fertig |

## Einrichtung Schritt für Schritt

Einmalig durch eine Person (meist den Meister). Dauer: etwa 15 Minuten. Alles ist kostenlos.

### 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> kostenlos registrieren und anmelden.
2. **New project** wählen, einen Namen vergeben (z. B. `dsa5`), ein Datenbank-Passwort festlegen
   (wird für die App nicht gebraucht, aber gut aufheben) und als Region **Central EU (Frankfurt)** wählen.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

> Kostenlose Projekte werden nach etwa einer Woche ohne Nutzung pausiert. Dann im Dashboard beim
> Projekt auf **Restore** klicken – die Daten bleiben erhalten.

### 2. Anonyme Anmeldung einschalten

Die App meldet jedes Gerät anonym an – niemand braucht eine E-Mail-Adresse.

1. Im Dashboard links **Authentication** → **Sign In / Providers** öffnen.
2. **Allow anonymous sign-ins** einschalten und speichern.

### 3. Datenbank anlegen (SQL ausführen)

1. Links **SQL Editor** öffnen → **New query**.
2. Den kompletten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen.
3. **Run** klicken. Erwartet: „Success. No rows returned“.

Das Skript legt die Tabellen `rooms` (inkl. laufendem Kampf und gezeigter Karte), `room_members`,
`characters` (Held als `jsonb`), `rolls` (Würfelprotokoll), `maps` und `tokens` (Karten und Figuren)
an, dazu den nicht öffentlichen Bildspeicher `karten` (Supabase Storage), die Zugriffsregeln
(Row Level Security), die Funktionen zum Erstellen/Beitreten und die Realtime-Freigaben. Es darf jederzeit erneut
ausgeführt werden – **nach jedem Update der App bitte einmal erneut ausführen**, damit neue
Spalten und Regeln dazukommen (bestehende Daten bleiben erhalten).

### 4. Schlüssel eintragen

1. Im Dashboard oben auf **Connect** klicken (oder **Project Settings** → **API Keys** / **Data API**).
2. Die **Project URL** (z. B. `https://abcdefgh.supabase.co` – nur bis `.supabase.co`, ohne `/rest/v1/`;
   die App schneidet so einen Zusatz aber auch selbst ab) und den öffentlichen **anon**- bzw.
   **publishable**-Key kopieren.
3. In [`js/config.js`](js/config.js) eintragen:

   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi…'; // oder 'sb_publishable_…'
   ```

**Niemals** den `service_role`- bzw. `secret`-Key eintragen – der gehört nie in eine Website.
Der anon-Key darf öffentlich sein: Was jemand damit darf, regeln die Zugriffsregeln aus Schritt 3.

### 5. Lokal ausprobieren (optional)

ES-Module laden nicht über `file://`. Deshalb über einen einfachen Webserver öffnen:

```bash
# im Projektordner
python3 -m http.server 8000
```

Dann <http://localhost:8000/> öffnen.

Wer an den Dateien arbeitet: Wegen des Offline-Speichers erscheinen Änderungen erst nach zweimaligem
Neuladen – oder in den Entwicklertools unter **Application** → **Service Workers** „Update on reload“ anhaken.

### 6. Auf GitHub Pages veröffentlichen

1. Die Dateien in ein GitHub-Repository hochladen (inkl. der geänderten `js/config.js`).
2. Im Repository **Settings** → **Pages** öffnen.
3. Unter **Build and deployment** → **Source** „Deploy from a branch“ wählen, dann den Branch
   (z. B. `main`) und den Ordner **/ (root)** auswählen und **Save** klicken.
4. Nach ein bis zwei Minuten ist die App unter `https://<benutzername>.github.io/<repository>/` erreichbar.
   Die Adresse steht auch oben auf der Pages-Seite.

Die Datei `.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert ausliefert.

### 7. Losspielen

1. Der Meister öffnet die App → **Neuen Raum erstellen** → Namen eingeben – fertig (kein Passwort nötig).
2. Unter **Gruppe** → **Einladung teilen** den Link (oder den 6-stelligen Raumcode) an die Gruppe schicken.
3. Spieler öffnen den Link → Namen eingeben → **Beitreten** → **Neuen Helden anlegen**
   (oder einen Helden von diesem Gerät, aus einer Sicherung oder aus **Optolith** übernehmen – siehe unten).

### 8. Als App auf dem Handy installieren (empfohlen)

Installiert startet die App ohne Adressleiste im Vollbild, hat ein eigenes Symbol und lässt sich
auch ohne Internet öffnen.

- **Android (Chrome, Edge):** App öffnen → Menü **⋮** der App →
  **App auf dem Startbildschirm installieren**. Alternativ im Browsermenü **App installieren**
  bzw. **Zum Startbildschirm hinzufügen** (so auch in anderen Android-Browsern).
- **iPhone/iPad (Safari):** App in Safari öffnen → **Teilen** (Quadrat mit Pfeil) →
  **Zum Home-Bildschirm** → **Hinzufügen**.
- **Computer (Chrome, Edge):** Installieren-Symbol rechts in der Adressleiste.

Die App muss dazu über `https://` laufen (GitHub Pages erfüllt das) – bzw. lokal über `http://localhost`.

## Räume, Rollen und Geräte

- **Meister** sieht unter **Gruppe** alle Helden live (LE, AsP, KaP, SchiP, Zustände), öffnet sie per
  **Öffnen** im Held-Tab und kann sie dort bearbeiten. Von einem weiteren Gerät tritt der Meister
  mit Raumcode + **Ich bin Meister** bei.
- **Spieler** sehen und bearbeiten nur ihren eigenen Helden – das erzwingt die Datenbank, nicht nur die App.
- **Gleichzeitige Änderungen:** Zieht der Meister LE ab, während der Spieler Notizen tippt, bleibt
  beides erhalten. Ändern beide genau dasselbe Feld, gewinnt die letzte Eingabe auf dem Gerät, das
  später speichert.
- **Gerät gewechselt?** Jedes Gerät hat eine eigene anonyme Anmeldung. Auf dem neuen Gerät dem Raum
  beitreten, dann weist der Meister unter **Gruppe** → **Gehört** den Helden dem neuen Eintrag zu.
  Alternativ: Held exportieren und auf dem neuen Gerät aus der Datei laden.
- **Kein Passwort:** Meister wird, wer den Raum erstellt oder beim Beitreten **Ich bin Meister**
  ankreuzt. Das ist bewusst einfach gehalten – wer den Raumcode kennt, gehört zur Gruppe. Den Code
  deshalb nur in der Gruppe teilen.
- **Würfelprotokoll:** Jeder Wurf landet mit Heldennamen und Uhrzeit im gemeinsamen Protokoll.
  Pro Wurf wählbar: **Öffentlich** (alle sehen ihn), **Nur Meister** (du und der Meister) oder
  **Verdeckt** (nur der Meister – du selbst siehst das Ergebnis nicht, z. B. für Sinnesschärfe).
  Der Meister bekommt verdeckte und Nur-Meister-Würfe zusätzlich als Meldung. Neue Würfe anderer
  zeigt eine Zahl am Protokoll-Tab. Nur der Meister kann das Protokoll für alle leeren.
- **Kampf & Initiative:** Der Meister startet unter **Gruppe** einen Kampf. Spieler würfeln ihre
  Initiative im Heldenbogen (Basiswerte → Initiative) oder im Tab **Würfeln** – sie erscheint
  automatisch in der Reihenfolge. Der Meister kann für Helden würfeln, Gegner hinzufügen
  (z. B. „Ork“, INI-Basis 10, Anzahl 3), mit **Weiter ▶** durchklicken (nach dem Letzten beginnt
  die nächste Kampfrunde) und unter „Werte anpassen“ Initiative ändern oder Einträge entfernen.
  Alle sehen die Reihenfolge live; wer dran ist, bekommt **„Du bist am Zug!“**.
- **Meister-Übersicht:** Unter **Gruppe** stehen alle Helden mit LE, AsP, KaP, SchiP und
  Zuständen – live. LE lässt sich dort direkt mit −/+ ändern (z. B. Schaden abziehen).
- **Karte:** Im Tab **Karte** zeigt der Meister eine Karte mit Figuren (siehe „Karte“ unten).
  Spieler sehen nur die gezeigte Karte und bewegen nur die Figur ihres eigenen Helden.
- **Offline:** Jede Änderung wird zuerst auf dem Gerät gespeichert. Oben steht dann
  „offline – wird später übertragen“. Sobald wieder eine Verbindung besteht, wird mit dem Serverstand
  zusammengeführt und gespeichert. Würfe ohne Verbindung stehen mit „wird übertragen …“ im
  Protokoll und werden nachgereicht.
- **Offline starten:** Nach dem ersten Öffnen mit Internet startet die App auch ohne Verbindung –
  im Raum mit dem zuletzt auf diesem Gerät gespeicherten Stand des Helden. Der Bogen ist dann
  voll lesbar und bearbeitbar; alles wird abgeglichen, sobald das Handy wieder online ist.
  Ohne Verbindung beitreten oder einen neuen Raum erstellen geht natürlich nicht.

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
  Im Raum gemeinsam für alle (je nach Sichtbarkeit), ohne Raum nur auf diesem Gerät.
- **Gruppe** (nur im Raum): Kampf & Initiative, Raumcode, Einladung, Helden, Mitglieder; **Raum verlassen**.
- **Menü (⋮):** Export/Import, Einladung teilen, Raum verlassen bzw. „Mit einer Gruppe spielen“,
  App installieren, außerdem die Geräteeinstellungen:
  - **Farbmodus** Hell / Dunkel / Automatisch (folgt dem Handy). Der helle Modus hat starken Kontrast
    für draußen und helles Licht.
  - **Schriftgröße** Normal / Groß / Sehr groß – vergrößert die ganze App, auch Knöpfe.
  - **Bildschirm nicht ausschalten (am Spieltisch)** – das Handy bleibt an, solange die App offen ist
    (erscheint nur in Browsern, die das unterstützen, z. B. Chrome unter Android).
- **Bedienung am Handy:** Alle Knöpfe sind mindestens 44 px groß, die Tab-Leiste liegt unten in
  Daumenreichweite, Eingabefelder zoomen beim Antippen nicht (iPhone). Auf großen Bildschirmen
  steht der Heldenbogen zweispaltig.

## Helden aus Optolith übernehmen

Wer seine Helden mit [Optolith](https://github.com/elyukai/optolith-client) gebaut hat, muss nichts abtippen:

1. In Optolith den Helden öffnen → **Heldenbögen** → den **MapTool-Export** speichern (Datei `.rptok`).
2. Zusätzlich empfohlen: In der Heldenliste den Helden **exportieren** (Datei `.json`).
3. In der App: im Raum **„Helden aus Datei laden (Sicherung oder Optolith)“** (bzw. Menü → „Held aus Datei
   ersetzen …“), ohne Raum Menü → **„Held importieren …“** – und **beide Dateien zusammen** auswählen.

Danach zeigt die App, was übernommen wurde und was noch fehlt. Im Raum ist der Held damit sofort
auf dem Server gespeichert und für den Meister sichtbar.

- **Aus der `.rptok`:** Eigenschaften, LeP/AsP/KaP, SK, ZK, AW, INI, GS, Schicksalspunkte, AP gesamt und
  ausgegeben, alle Talente mit Probe, Spezialisierungen, Kampftechniken, Vorteile, Nachteile,
  Sonderfertigkeiten, Sprachen und Schriften (mit Stufe), Berufsgeheimnisse, Zauber, Rituale,
  Liturgien und Zeremonien (mit Probe), Waffen (TP inkl. Schadensbonus, AT/PA, Reichweite), Rüstung,
  Inventar und Geld.
- **Aus der `.json` zusätzlich:** Spezies, Erfahrungsgrad, persönliche Daten (Familie, Geburtsort,
  Alter, Größe, Gewicht, Sozialstatus …) und Gegenstandsarten – Tiere landen beim Packtier, Wagen
  beim Wagen.
- **Von Hand nachtragen:** Kultur und Profession, Haar-/Augenfarbe, Zaubertricks und Segnungen sowie
  Kosten/Dauer/Reichweite von Zaubern – diese Namen bzw. Angaben exportiert Optolith nicht.
- Nur die `.json` geht auch: Dann fehlen die Namen von Vorteilen, Sonderfertigkeiten und Zaubern
  (Optolith speichert dort nur Nummern), LeP, SK und ZK werden aus Spezies und Eigenschaften berechnet.
- Einen **PDF-Heldenbogen** kann die App nicht einlesen.

## Karte

**Meister**

1. Tab **Karte** → **Karte hochladen** (JPG, PNG oder WebP, z. B. Dungeon, Taverne, Landkarte).
   Große Bilder verkleinert die App automatisch (längste Seite 3000 Punkte, höchstens 5 MB).
   Handyfotos im HEIC-Format bitte vorher als JPG speichern.
2. Eine neue Karte sieht zunächst **nur der Meister** („Vorbereitung“) – in Ruhe Figuren aufstellen,
   dann **Allen zeigen**. **Mehrere Karten offen:** Über der Karte stehen Tabs – die gezeigte Karte mit
   Auge 👁, daneben die Karten, die du gerade vorbereitest. Ein Tipp wechselt hin und her, × schließt
   den Tab (die Karte bleibt), **+ Karte** öffnet eine weitere oder lädt eine neue hoch. Während du eine
   andere Karte bearbeitest, sehen die Spieler weiter die gezeigte. Unter **Karten** lassen sich alle
   Karten verwalten: öffnen, allen zeigen, ausblenden, umbenennen, löschen (mit allen Figuren darauf).
3. **Raster:** an/aus, Feldgröße (oder „Felder in der Breite“), Versatz und Linienfarbe. Hat das Bild
   schon Kästchen, die Werte so einstellen, dass die Linien übereinander liegen. Bei sichtbarem
   Raster rasten Figuren beim Ablegen in die Felder ein (große Figuren mit 2 × 2 Feldern auf die Linien).
4. **+ Figur:** Name, Anzahl (mehrere werden nummeriert: Ork 1, Ork 2 …), **Lebensenergie (LeP)** für
   Gegner und NSC (jede Figur startet mit vollen LeP, leer = ohne LeP), Größe (½ bis 4 × 4 Felder),
   Farbe, optional ein Bild (wird quadratisch zugeschnitten) und **Verborgen** – verborgene Figuren
   sieht nur der Meister (z. B. für einen Hinterhalt). Gehört die Figur zu einem Helden, darf dessen
   Spieler sie bewegen; seine LeP stehen dann im Heldenbogen.
5. **Helden:** stellt alle Helden des Raums auf, die noch fehlen (mit ihrem Bild von einer früheren Karte).
6. **Figur antippen** wählt sie aus; unter der Karte erscheint ein Panel:
   - **Held:** LeP, AsP, KaP und Schicksalspunkte mit − / + ändern oder direkt eintippen, Zustände
     (Schmerz, Belastung …) hoch- und runtersetzen. Die Änderung landet sofort im Heldenbogen des
     Spielers; trägt er gleichzeitig etwas anderes ein, bleibt beides erhalten. AsP und KaP stehen
     nur da, wenn der Held welche hat.
   - **Gegner/NSC:** LeP mit − / + ändern oder eintippen, dahinter das Maximum (ebenfalls eintippbar;
     eine unverletzte Figur hat danach wieder volle LeP). Ohne eingetragene LeP zählt − / + ab 0.
   - **Heldenbogen** öffnet den ganzen Bogen, **Figur bearbeiten** Name, Held, Größe, Farbe, Bild und
     Entfernen, **Verbergen/Zeigen** blendet die Figur für die Spieler aus und ein.
   - × oder ein Tipp auf eine freie Stelle der Karte hebt die Auswahl auf.
7. **Mehrere Figuren markieren** – wie am Desktop:
   - Maus: auf freier Fläche mit der linken Taste einen **Rahmen aufziehen**; ein Klick mit gedrückter
     **Strg**- oder **Umschalt**-Taste nimmt einzelne Figuren dazu oder heraus.
   - Handy/Tablet: Knopf **Auswählen** (gestricheltes Quadrat rechts), dann mit dem Finger einen Rahmen
     ziehen; nochmal tippen schaltet zurück aufs Verschieben.
   - Eine markierte Figur ziehen bewegt **alle gemeinsam**, die Aufstellung bleibt erhalten (jede rastet
     ins Raster ein). Das Panel listet die Figuren mit ihren LeP (Helden und Gegner) und kann alle zusammen
     verbergen, zeigen oder entfernen.
   - Tastatur: Pfeiltasten bewegen alle markierten um ein Feld, **Entf** entfernt sie (mit Rückfrage),
     **Esc** hebt die Auswahl auf, **Enter** auf einer Figur öffnet „Figur bearbeiten“.

**Spieler**

- **Meine Figur aufstellen:** Steht die eigene Figur noch nicht auf der gezeigten Karte, stellt man sie
  selbst auf – mit Farbe und auf Wunsch eigenem Bild (sonst das Bild der letzten Figur). Danach ziehen.

**Alle – der Spielbildschirm**

Der Tab **Karte** ist der Spielbildschirm und öffnet sich beim Betreten des Raums (wer noch keinen
Helden hat, beginnt im Tab **Held**). Wer einen Helden geöffnet hat, hat dort alles zum Spielen:

- **Links „Werte“:** LeP, AsP, KaP und Schicksalspunkte mit − / + ändern oder eintippen, Zustände
  (Schmerz, Betäubung …) hoch- und runtersetzen – wie im Heldenbogen, sofort für alle.
- **Rechts „Proben“:** alle Proben zum Antippen – Eigenschaften, Kampf (Ausweichen, Initiative, Waffen),
  alle Talente nach Gruppen, Zauber und Liturgien, Kampftechniken; ganz oben die zuletzt gewürfelten.
  **Probe suchen:** ein paar Buchstaben tippen („sinn“, „körper“, „igni“). Es öffnet sich derselbe
  Probendialog wie im Heldenbogen; der Wurf landet im Protokoll.
- Am PC stehen beide Seiten neben der Karte. Am Handy kommen sie als Schublade: Knopf unten links (zeigt
  LeP/AsP) bzw. **Proben** unten rechts; Tipp auf die eigene Figur öffnet die Werte, × oder Esc schließt.
- **Favoriten ☆:** Neben jeder Probe ein Stern – gemerkte Proben (z. B. Angriff und Parade der Waffe,
  Ausweichen) stehen oben unter „★ Favoriten“ und im Kampf als Schnellknöpfe. Sie werden im Helden
  gespeichert, gelten also auf jedem Gerät.
- **Letzte Würfe** über der Karte, live für alle (gleiche Sichtbarkeit wie im Protokoll): am Handy der
  neueste („mehr“ zeigt fünf), am PC drei; **Protokoll ›** führt zum ganzen Protokoll.

**Kampf auf dem Spielbildschirm**

1. Der Meister tippt **⚔ Kampf** – der Kampf läuft sofort, über der Karte erscheint die Kampfleiste.
2. Alle Spieler bekommen die Meldung „Kampf! Würfle deine Initiative“ (mit Knopf **Würfeln**) und in der
   Kampfleiste den großen Knopf **Initiative würfeln**. Der Meister sieht, wer noch fehlt, und kann
   für sie würfeln.
3. **+ Gegner:** Gegner von der Karte mit einem Tipp übernehmen – INI-Basis je Art eintragen (wird für den
   nächsten Kampf gemerkt), jede Figur behält ihren Namen (Ork 1, Ork 3 …); weitere Gegner von Hand.
4. **Start ▶ / Weiter ▶** – wer dran ist, ist hervorgehoben; wer selbst dran ist, sieht „Du bist am Zug!“
   und hat seine Favoriten (Angriffe …) direkt in der Leiste. **Ende** beendet den Kampf für alle.
   (Werte anpassen und Einträge entfernen geht weiterhin im Tab **Gruppe**.)

- **Lebensbalken** unter den Figuren:
  - **Helden:** genauer Balken für alle – so sieht die Gruppe, wie es um jeden steht.
  - **Gegner und NSC** (wenn der Meister LeP eingetragen hat): Balken aus vier Vierteln. Spieler sehen
    nur, in welchem Viertel der Gegner steckt (voll gefüllte Abschnitte), nicht die genauen LeP; der
    Meister sieht den Balken genau. Die Viertel passen zu den Schmerzstufen (¾, ½, ¼).
  - Grün über der Hälfte, gelb bis zu einem Viertel, rot darunter; ohne LeP wird die Figur grau.
  - Weit herausgezoomt stehen Balken (wie Namen) nur bei der eigenen Figur, der Figur am Zug und der
    ausgewählten – herangezoomt bei allen.
- Karte mit einem Finger verschieben, mit zwei Fingern (oder Mausrad, Knöpfe + und −) zoomen,
  ◎ zeigt die ganze Karte, ⛶ schaltet auf Vollbild. Mit der Maus verschiebt man die Karte mit der
  rechten (oder mittleren) Taste bzw. mit gedrückter Leertaste – beim Meister zieht die linke Taste ja
  den Auswahlrahmen.
- Figuren, Namen und Figurenbilder bleiben auch stark vergrößert scharf (sie werden in echter
  Bildschirmgröße gezeichnet, nicht mit der Karte hochskaliert). Figurenbilder werden mit bis zu
  512 × 512 Punkten gespeichert; ältere, kleinere Bilder einfach neu hochladen („Figur bearbeiten“).
  Weit herausgezoomt blenden sich Namen aus – außer bei der eigenen und der Figur am Zug.
- Figuren ziehen (Drag & Drop): Der Meister jede Figur, Spieler nur die eigene. Am Computer bewegen
  die Pfeiltasten eine ausgewählte Figur um ein Feld.
- Alles erscheint sofort bei allen. Läuft ein Kampf, leuchtet die Figur, die am Zug ist
  (Helden über den Helden, Gegner über den Namen – z. B. „Ork 1“ im Kampf und auf der Karte).
- Bilder werden nach dem ersten Laden auf dem Gerät gespeichert und nicht erneut heruntergeladen.
  Die Karte selbst braucht eine Verbindung; ohne Netz zeigt der Tab einen Hinweis.

## Fehlerbehebung

| Meldung                                                     | Lösung                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| „Server noch nicht eingerichtet“                            | `js/config.js` ausfüllen (Schritt 4).                                |
| „Anonyme Anmeldung ist im Supabase-Projekt ausgeschaltet …“ | Schritt 2 nachholen.                                                 |
| „Die Datenbank in Supabase ist älter als die App …“         | Knopf **So geht’s**: Skript kopieren, im SQL Editor einfügen, Run.   |
| „Die App ist älter als eure Datenbank“                      | Seite neu laden (am Handy notfalls zweimal).                         |
| „Der Supabase-Schlüssel in js/config.js ist ungültig.“      | URL und anon-Key erneut kopieren.                                    |
| „Keine Verbindung zum Server …“                             | Internet prüfen; ist das Projekt pausiert, im Dashboard **Restore**. |
| „Kein Raum mit diesem Code gefunden.“                       | Code prüfen (Groß-/Kleinschreibung ist egal).                        |
| Nach einem Update ist noch die alte Version zu sehen        | Seite mit Strg+F5 (am Handy: zweimal) neu laden.                     |
| „Die App konnte nicht geladen werden …“                     | Werbe-/Tracker-Blocker für die Seite ausschalten, dann neu laden.    |
| „Der Speicher für Kartenbilder fehlt …“                     | `supabase/schema.sql` erneut ausführen (legt den Speicher an).       |
| „Dieses Bild kann der Browser nicht öffnen …“               | Bild als JPG oder PNG speichern (z. B. HEIC-Fotos vom iPhone).       |

## Tests

Webserver wie oben starten und <http://localhost:8000/tests/rules.test.html> öffnen. Die Seite prüft
Regeln, Würfel, Heldenmodell, Proben, Zusammenführen gleichzeitiger Änderungen, den Abgleich,
das gemeinsame Protokoll, die Kampfreihenfolge sowie Raster, Einrasten, Zoom, Auswahlrahmen,
gemeinsames Bewegen und die Karten-Steuerung
(mit Attrappen statt Server). Oben steht „Alle … Tests bestanden ✓“ oder fehlgeschlagene Tests
erscheinen rot mit erwartetem und erhaltenem Wert. Die fünf Pflicht-Testfälle stehen ganz oben.

## Technisches

- **supabase-js** wird in fester Version vom CDN jsDelivr geladen, mit Integritätsprüfung (SRI).
  Wer die Version ändert, muss in `js/supabase.js` auch den Hash anpassen:
  `curl -s <URL> | openssl dgst -sha384 -binary | openssl base64 -A`
- Würfe werden auf dem eigenen Gerät mit `crypto.getRandomValues` gewürfelt. Verdeckte Würfe sieht
  der Spieler in der App nicht; wer sich im Browser in die Datenübertragung einliest, könnte sie
  finden – für eine Runde unter Freunden ist das so gewollt einfach gehalten. Dasselbe gilt für die
  LeP von Gegnern: Die App zeigt sie Spielern nur in Vierteln, übertragen werden sie mit der Figur
  genau. Für die Lebensbalken spiegelt die Datenbank die LeP jedes Helden auf seine Figuren (sonst
  dürfen Spieler fremde Heldenbögen nicht lesen – daran ändert sich nichts).
- **Offline-Speicher (Service Worker, `sw.js`):** Mit Verbindung kommen Seite und App-Dateien immer
  frisch vom Server (am Browser-Cache vorbei), ohne Verbindung – oder wenn das Netz länger als
  4 Sekunden braucht – aus dem Speicher. Anfragen an Supabase (Helden, Würfe, Anmeldung) werden nie
  zwischengespeichert – dafür sorgt die App selbst mit Gerätespeicher und Warteschlange.
- **Updates:** Geänderte Dateien auf GitHub Pages (auch `js/config.js`) gelten beim nächsten Öffnen
  der App. Ändert sich `sw.js`, lädt sich die geöffnete App nach wenigen Sekunden einmal selbst neu.
  Hat sich `supabase/schema.sql` geändert, das Skript einmal erneut im SQL Editor ausführen (es darf
  mehrfach laufen, Räume, Helden und Karten bleiben erhalten). Die App prüft beim Start, ob ihr Stand
  zur Datenbank passt (`schema_version()` in `schema.sql` und `SCHEMA_VERSION` in `js/supabase.js` –
  bei jeder Schemaänderung beide hochzählen), und bietet sonst den Knopf **So geht’s** an: Skript
  kopieren, SQL Editor des eigenen Projekts öffnen, einfügen, Run.
  Bei größeren Updates am besten in `sw.js` die Versionsnummer in `CACHE_NAME` erhöhen
  (z. B. `'dsa5-app-v4'` → `'dsa5-app-v5'`): Dann wird der alte Speicher vollständig gelöscht.
- **Kartenbilder** liegen im nicht öffentlichen Supabase-Speicher `karten` unter `<Raum-ID>/…`:
  Sehen dürfen sie nur Mitglieder des Raums, hochladen und löschen nur der Meister. Nicht mehr
  benutzte Bilder löscht die App beim Entfernen von Karten und Figuren. Ob Spieler eine Karte
  sehen, entscheidet die Datenbank (gezeigte Karte, verborgene Figuren) – nicht nur die App.
- **Werbe- und Tracker-Blocker** (z. B. in Opera GX, Brave, uBlock Origin) sperren Dateien auch nach
  ihrem Namen. Schon eine gesperrte Datei verhindert den Start der ganzen App. Deshalb heißt z. B. die
  Protokoll-Ansicht `protocol-view.js` und nicht `log-view.js` (steht in EasyPrivacy). Neue Dateien
  besser nicht `log-view.js`, `analytics.js`, `tracking.js`, `ads.js` o. Ä. nennen.
- Nutzereingaben werden nie als HTML eingefügt (`js/ui/dom.js`), damit niemand über Heldennamen
  o. Ä. Code in fremde Browser schleusen kann.

## Dateistruktur

```
index.html               Einstieg der App
.nojekyll                GitHub Pages: Dateien unverändert ausliefern
manifest.webmanifest     App-Beschreibung für die Installation (Name, Symbole, Farben)
sw.js                    Service Worker: App offline starten
icons/                   App-Symbole (SVG und PNG, auch für iPhone und Android)
css/style.css            Gestaltung (mobile-first, Hell/Dunkel, Schriftgrößen)
supabase/schema.sql      Tabellen, Zugriffsregeln (RLS), Funktionen, Realtime
js/config.js             Supabase-URL und öffentlicher anon-Key
js/app.js                Start: Startseite, Raum oder „Ohne Raum“
js/mode-room.js          Raum-Modus: verbinden, Held öffnen, live abgleichen, Gruppe, Karte
js/room-map.js           Karte im Raum: laden, live aktuell halten, Aktionen (Meister/Spieler)
js/map.js                Karte als reine Funktionen: Raster, Einrasten, Aufstellen, Zoom, Auswahl
js/map-api.js            Karte auf dem Server: Karten, Figuren, Bilder (Storage), Realtime
js/image.js              Bilder vor dem Hochladen verkleinern bzw. zuschneiden
js/room-log.js           Gemeinsames Würfelprotokoll (Server, Warteschlange für offline)
js/room-combat.js        Kampf im Raum: speichern, Initiative-Würfe übernehmen, „am Zug“
js/combat.js             Kampfreihenfolge als reine Funktionen (Initiative, Runden)
js/mode-local.js         Modus „Ohne Raum“: Held nur auf diesem Gerät
js/supabase.js           Server: supabase-js laden, anonym anmelden, Fehlermeldungen
js/room.js               Räume erstellen/beitreten/verlassen, Sitzung, Eingaben prüfen
js/optolith.js           Import aus Optolith: MapTool-Token (.rptok) und Heldendatei (.json)
js/hero-files.js         Gewählte Helden-Dateien erkennen (Sicherung, .rptok, Optolith-.json)
js/zip.js                Dateien aus ZIP-Archiven lesen (die .rptok ist ein ZIP)
js/sync.js               Helden laden/speichern, Offline-Speicher, Realtime
js/merge.js              Gleichzeitige Änderungen zusammenführen (Drei-Wege-Merge)
js/rules.js              Reine DSA5-Regel-Logik (kein DOM, kein Zufall)
js/dice.js               Würfeln mit crypto.getRandomValues, Würfelausdrücke wie 2W6+3
js/data/talents.js       Stammdaten: 59 Talente, Kampftechniken, Zauberarten
js/sheet.js              Heldenmodell: Standardheld, Reparieren, Export/Import, abgeleitete Werte
js/checks.js             Proben ausführen (Held + Würfel + Regeln → Protokolleintrag), Schicksalspunkte
js/format.js             Texte für Ergebnisse und Modifikatoren
js/store.js              Hält den Helden und meldet Änderungen an die Ansichten
js/saver.js              Speichern mit Verzögerung (Debounce) und Statusanzeige
js/log.js                Sichtbarkeit von Würfen, Würfelprotokoll dieses Geräts
js/storage.js            Sicherer Zugriff auf localStorage
js/pwa.js                Service Worker anmelden, App installieren, Bildschirm anlassen
js/util.js               Allgemeine Hilfsfunktionen
js/ui/shell.js           Rahmen: Kopfzeile, Tabs, Ansichten
js/ui/home-view.js       Startseite (Raum beitreten/erstellen, ohne Raum)
js/ui/group-view.js      Tab „Gruppe“ (Meister-Übersicht)
js/ui/combat-view.js     Kampfkarte: Initiative-Reihenfolge, wer ist am Zug
js/ui/map-view.js        Tab „Karte“: Werkzeugleiste, Hinweise, Raster einstellen
js/ui/map-stage.js       Karte zum Anfassen: verschieben, zoomen, Figuren auswählen und ziehen
js/ui/map-inspector.js   Meister: Panel für ausgewählte Figuren (LeP, AsP, Zustände, verbergen …)
js/ui/play-panels.js     Spielbildschirm: Seiten „Werte“ (links) und „Proben“ (rechts, mit Favoriten)
js/ui/play-combat.js     Spielbildschirm: Kampfleiste, Initiative, Gegner von der Karte
js/ui/play-log.js        Spielbildschirm: letzte Würfe
js/ui/schema-help.js     Anleitung „Datenbank aktualisieren“ (Skript kopieren, SQL Editor öffnen)
js/check-search.js       Proben suchen (Talente, Zauber, Eigenschaften, Kampf), zuletzt gewürfelt
js/ui/map-dialogs.js     Meister: Karten verwalten, Figuren aufstellen und bearbeiten
js/ui/visibility-control.js  Auswahl „Öffentlich / Nur Meister / Verdeckt“
js/ui/hero-choice.js     Held anlegen/übernehmen, Verbindungszustände
js/ui/hero-file.js       Held als JSON sichern und laden, Importbericht (Optolith)
js/ui/dom.js             Sicheres Erzeugen von Elementen (nie innerHTML mit Nutzerdaten)
js/ui/fields.js          An den Helden gebundene Eingabefelder
js/ui/dialog.js          Dialoge (am Handy als Blatt von unten)
js/ui/toast.js           Meldungen, auch Fehler und „Rückgängig“
js/ui/check-dialog.js    Probendialog
js/ui/roll-view.js       Darstellung von Würfen (Dialog und Protokoll)
js/ui/roll-actions.js    Würfelknöpfe → Probenbeschreibung
js/ui/dice-view.js       Tab „Würfeln“
js/ui/protocol-view.js   Tab „Protokoll“
js/ui/menu.js            Menü mit Geräteeinstellungen
js/ui/theme.js           Hell-/Dunkelmodus und Schriftgröße
js/ui/segmented.js       Umschalter mit mehreren Optionen (z. B. Hell/Dunkel/Automatisch)
js/ui/sheet/*.js         Heldenbogen: Bereiche, berechnete Anzeigen, Steuerung
tests/rules.test.html    Testseite – prüft alles automatisch
tests/*.test.js          Testfälle
```

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
