/**
 * hero-choice.js – Inhalt des Held-Tabs, solange kein Held geöffnet ist:
 * Spieler wählen ihren Helden aus den Helden des Raums (nach jedem Beitreten) oder legen einen
 * an (neu, vom Gerät übernehmen, aus Datei); dazu Hinweise für den Meister sowie Verbindungs-
 * und Fehlerzustände.
 */
import { h } from './dom.js';
import { pickHeroFile, showImportReport, IMPORT_HINT } from './hero-file.js';
import { createHero, heroName } from '../sheet.js';

function card(title, ...content) {
  return h('section', { class: 'card choice-card' }, h('h2', {}, title), content);
}

/** Kurztext, wem ein Held gehört (siehe describeRoomHeroes in room.js). */
export function heroOwnerLabel(entry) {
  if (entry.status === 'mine') return 'Dein Held';
  if (entry.status === 'free') return 'frei';
  return `gehört ${entry.ownerName}${entry.ownerIsMaster ? ' (Meister)' : ''}`;
}

function renderPickList({ heroes, heroesError, onPick, onReloadHeroes }) {
  if (heroesError) {
    return h(
      'div',
      { class: 'stack' },
      h('p', { class: 'error-text' }, `Die Helden des Raums konnten nicht geladen werden: ${heroesError}`),
      h('button', { type: 'button', class: 'btn', onclick: onReloadHeroes }, 'Erneut laden'),
    );
  }
  if (!heroes) return h('p', { class: 'section-hint' }, 'Lade die Helden des Raums …');
  if (heroes.length === 0) return h('p', {}, 'Im Raum gibt es noch keine Helden. Lege deinen an:');
  return h(
    'div',
    { class: 'hero-pick-list' },
    heroes.map((entry) =>
      h(
        'button',
        { type: 'button', class: `hero-pick is-${entry.status}`, onclick: () => onPick(entry) },
        h(
          'span',
          { class: 'hero-pick-text' },
          h('span', { class: 'hero-pick-name' }, entry.name),
          entry.detail ? h('small', {}, entry.detail) : null,
        ),
        h('span', { class: 'hero-pick-status' }, heroOwnerLabel(entry)),
      ),
    ),
  );
}

/**
 * @param {object} options
 * @param {'connecting'|'ready'|'offline'|'error'} options.state
 * @param {boolean} options.isMaster
 * @param {object|null} options.localHero   Held aus dem Modus „Ohne Raum“ auf diesem Gerät
 * @param {string} [options.errorMessage]
 * @param {Array|null} [options.heroes]     Spieler: Helden des Raums (describeRoomHeroes), null = lädt
 * @param {string} [options.heroesError]    Spieler: Fehler beim Laden der Helden
 * @param {string} [options.pickError]      Spieler: warum die letzte Auswahl nicht geklappt hat
 * @param {(heroData: object) => Promise<boolean|void>} options.onCreate  false = abgebrochen
 * @param {(entry: object) => Promise} [options.onPick]  Spieler: Helden aus der Liste wählen
 * @param {() => void} [options.onReloadHeroes]
 * @param {() => void} options.onRetry
 * @param {() => void} options.onShowGroup
 */
export function renderHeroChoice({
  state,
  isMaster,
  localHero,
  errorMessage,
  heroes = null,
  heroesError = '',
  pickError = '',
  onCreate,
  onPick,
  onReloadHeroes,
  onRetry,
  onShowGroup,
}) {
  if (state === 'connecting') {
    return card('Verbinde mit dem Raum …', h('p', { class: 'section-hint' }, 'Einen Moment bitte.'));
  }
  if (state === 'offline') {
    return card(
      'Offline',
      h(
        'p',
        {},
        'Dein Held ist auf diesem Gerät noch nicht gespeichert. Sobald du wieder online bist, geht es weiter.',
      ),
      h('button', { type: 'button', class: 'btn', onclick: onRetry }, 'Erneut versuchen'),
    );
  }
  if (state === 'error') {
    return card(
      'Verbindung fehlgeschlagen',
      h('p', { class: 'error-text' }, errorMessage),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onRetry }, 'Erneut versuchen'),
    );
  }

  const status = h('p', { class: 'error-text', hidden: !pickError, role: 'alert' }, pickError);
  let busy = false;
  /** Führt eine Auswahl aus – nie zwei gleichzeitig; Fehler stehen unter der Liste. */
  const act = async (action) => {
    if (busy) return;
    busy = true;
    status.hidden = true;
    try {
      await action();
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
    } finally {
      busy = false;
    }
  };
  /** loadHero liefert { hero, report } (report nur beim Import aus Optolith) oder null. */
  const create = (loadHero) =>
    act(async () => {
      const loaded = await loadHero();
      if (!loaded) return;
      if ((await onCreate(loaded.hero)) === false) return;
      showImportReport(loaded.report);
    });

  const options = h(
    'div',
    { class: 'menu-list' },
    h(
      'button',
      { type: 'button', class: 'btn btn-primary', onclick: () => create(() => ({ hero: createHero() })) },
      'Neuen Helden anlegen',
    ),
    localHero
      ? h(
          'button',
          { type: 'button', class: 'btn', onclick: () => create(() => ({ hero: localHero })) },
          `„${heroName(localHero)}“ von diesem Gerät übernehmen`,
        )
      : null,
    h(
      'button',
      { type: 'button', class: 'btn', onclick: () => create(pickHeroFile) },
      'Helden aus Datei laden (Sicherung oder Optolith)',
    ),
    h('p', { class: 'section-hint' }, IMPORT_HINT),
  );

  if (isMaster) {
    return card(
      'Kein Held geöffnet',
      h('p', {}, 'Als Meister wählst du unter „Gruppe“ einen Helden aus, um ihn zu sehen und zu bearbeiten.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onShowGroup }, 'Zur Gruppe'),
      h('h3', {}, 'Oder eigenen Helden anlegen (z. B. NSC)'),
      options,
      status,
    );
  }
  const hasHeroes = Array.isArray(heroes) && heroes.length > 0;
  return card(
    'Wähle deinen Helden',
    h('p', {}, 'Mit welchem Helden spielst du in diesem Raum?'),
    renderPickList({ heroes, heroesError, onPick: (entry) => act(() => onPick(entry)), onReloadHeroes }),
    status,
    hasHeroes ? h('h3', {}, 'Oder neuen Helden') : null,
    options,
    h('p', { class: 'section-hint' }, 'Wechseln kannst du später im Menü unter „Anderen Helden wählen“.'),
  );
}
