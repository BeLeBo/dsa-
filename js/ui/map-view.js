/**
 * map-view.js – Tab „Karte“ im Raum, der Spielbildschirm: die Karte mit allen Figuren, live für
 * alle; daneben (Handy: als Schubladen) links die Werte, rechts die Proben des eigenen Helden.
 * Meister: mehrere Karten offen (Tabs), Raster einstellen, Figuren aufstellen und bearbeiten.
 * Spieler: sehen die gezeigte Karte, stellen ihre Figur auf und ziehen sie.
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { showToast, showError } from './toast.js';
import { segmentedControl } from './segmented.js';
import { createMapStage } from './map-stage.js';
import { openMapsDialog, openTokenDialog, openOwnTokenDialog } from './map-dialogs.js';
import { mapTabs } from '../room-map.js';
import { heroName } from '../sheet.js';
import { createMapInspector } from './map-inspector.js';
import { createVitalsPanel, createChecksPanel, poolSummary } from './play-panels.js';
import { confirmDialog } from './dialog.js';
import { imageUrl } from '../map-api.js';
import { currentEntry } from '../combat.js';
import {
  normalizeGrid,
  gridSizeFromCells,
  cellsAcross,
  tokensForTurn,
  tokenLifeBar,
  GRID_COLORS,
  MIN_GRID_SIZE,
  MAX_GRID_SIZE,
} from '../map.js';

/** Mindesthöhe der Karte, auch auf sehr kleinen Bildschirmen. */
const MIN_FRAME_HEIGHT = 260;

// ---------------------------------------------------------------------------
// Raster einstellen (Meister) – über der Karte, damit man das Ergebnis sofort sieht
// ---------------------------------------------------------------------------

function numberInput(label, { step, min, max }) {
  const input = h('input', { type: 'number', class: 'num', inputmode: 'decimal', step, min, max });
  return { input, element: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input) };
}

function stepperField(label, onStep) {
  const input = h('input', { type: 'number', class: 'num', inputmode: 'decimal', step: 1 });
  const button = (text, delta, name) =>
    h(
      'button',
      { type: 'button', class: 'step-button', 'aria-label': `${label} ${name}`, onclick: () => onStep(delta) },
      text,
    );
  return {
    input,
    element: h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, label),
      h('div', { class: 'stepper' }, button('−', -1, 'kleiner'), input, button('+', 1, 'größer')),
    ),
  };
}

function createGridPanel(controller, onToggle) {
  const current = () => {
    const map = controller.viewMap();
    return map ? { map, grid: normalizeGrid(map.grid, map) } : null;
  };
  const change = (changes) => controller.actions.updateGrid(changes);
  const stepBy = (key, delta) => {
    const values = current();
    if (values) change({ [key]: values.grid[key] + delta });
  };

  const show = h('input', { type: 'checkbox', onchange: (event) => change({ show: event.target.checked }) });
  const size = stepperField('Feldgröße (Punkte)', (delta) => stepBy('size', delta));
  const cells = numberInput('Felder in der Breite', { step: 0.5, min: 1, max: 500 });
  const offsetX = stepperField('Versatz waagrecht', (delta) => stepBy('offsetX', delta));
  const offsetY = stepperField('Versatz senkrecht', (delta) => stepBy('offsetY', delta));
  let colorControl = h('div');

  const onNumber = (input, apply) =>
    input.addEventListener('input', () => {
      const value = Number(input.value.replace(',', '.'));
      if (input.value.trim() !== '' && Number.isFinite(value)) apply(value);
    });
  onNumber(size.input, (value) => value >= MIN_GRID_SIZE && value <= MAX_GRID_SIZE && change({ size: value }));
  onNumber(cells.input, (value) => {
    const values = current();
    if (values && value > 0) change({ size: gridSizeFromCells(values.map.width, value) });
  });
  onNumber(offsetX.input, (value) => change({ offsetX: value }));
  onNumber(offsetY.input, (value) => change({ offsetY: value }));
  for (const input of [size.input, cells.input, offsetX.input, offsetY.input]) {
    input.addEventListener('blur', () => refresh());
  }

  const element = h(
    'section',
    { class: 'card map-grid-panel', hidden: true },
    h('h3', {}, 'Raster'),
    h('label', { class: 'check' }, show, h('span', {}, 'Raster anzeigen – Figuren rasten beim Ablegen ein')),
    h(
      'p',
      { class: 'section-hint' },
      'Hat das Kartenbild schon Kästchen? Dann Feldgröße (oder Anzahl Felder) und Versatz so einstellen, dass die Linien übereinander liegen.',
    ),
    h('div', { class: 'map-grid-fields' }, size.element, cells.element, offsetX.element, offsetY.element),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Linienfarbe'), colorControl),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close() }, 'Fertig'),
  );

  /** Werte aus dem Zustand übernehmen – außer im Feld, in dem gerade getippt wird. */
  function refresh() {
    const values = current();
    if (!values) return;
    const { map, grid } = values;
    show.checked = grid.show;
    const set = (input, value) => {
      if (input !== document.activeElement) input.value = String(value);
    };
    set(size.input, grid.size);
    set(cells.input, cellsAcross(map.width, grid.size));
    set(offsetX.input, grid.offsetX);
    set(offsetY.input, grid.offsetY);
  }

  function open() {
    const values = current();
    if (!values) return;
    const next = segmentedControl(GRID_COLORS, values.grid.color, (id) => change({ color: id }), 'Linienfarbe');
    colorControl.replaceWith(next);
    colorControl = next;
    element.hidden = false;
    refresh();
    onToggle();
  }

  function close() {
    element.hidden = true;
    controller.actions.flushGrid();
    onToggle();
  }

  return { element, refresh, open, close, isOpen: () => !element.hidden };
}

// ---------------------------------------------------------------------------
// Tab „Karte“
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} panel
 * @param {object} options
 * @param {object} options.controller   siehe room-map.js
 * @param {object} options.room         Raum-Zustand (Helden, Kampf)
 * @param {() => boolean} options.isMaster
 * @param {() => string|null} options.myCharacterId  eigener Held (Spieler)
 * @param {(characterId: string) => object|null} options.heroFor  Heldendaten (Meister: alle)
 * @param {object} options.heroActions  { adjustPool, setPool, setCondition, open } – siehe mode-room.js
 * @param {(listener: Function) => Function} options.subscribeHero  Änderungen am geöffneten Helden
 * @param {object} options.store          Store mit dem geöffneten Helden (Leiste „Probe & Werte“)
 * @param {() => string|null} options.openHeroId  ID des auf diesem Gerät geöffneten Helden
 * @param {(spec: object) => void} options.openCheck  Probendialog öffnen
 */
export function createMapView(
  panel,
  { controller, room, isMaster, myCharacterId, heroFor, heroActions, subscribeHero, store, openHeroId, openCheck },
) {
  const canMove = (token) => isMaster() || (Boolean(token.character_id) && token.character_id === myCharacterId());
  const editToken = (token) =>
    openTokenDialog({ controller, token, characters: room.get().characters, center: stage.visibleCenter });

  async function removeTokens(ids) {
    const question =
      ids.length === 1 ? 'Diese Figur von der Karte nehmen?' : `${ids.length} Figuren von der Karte nehmen?`;
    if (!(await confirmDialog(question, { confirmLabel: 'Entfernen', danger: true }))) return;
    await run('Figuren nicht entfernt', () => controller.actions.removeTokens(ids));
  }

  const stage = createMapStage({
    canMove,
    isMine: (token) => !isMaster() && canMove(token),
    // Helden genau, Gegner für Spieler nur ungefähr (in welchem Viertel sie stecken).
    lifeOf: (token) =>
      tokenLifeBar(token, token.character_id ? heroFor(token.character_id) : null, { master: isMaster() }),
    selectable: isMaster,
    onMove: (moves) => controller.actions.moveTokens(moves).catch((error) => showError(error, 'Figur nicht bewegt')),
    onSelect: () => renderPanels(),
    // Spieler tippt die eigene Figur an: Werte aufklappen (am Handy die linke Schublade).
    onTap: (token) => {
      if (token.character_id && token.character_id === openHeroId()) openDrawer('left');
    },
    onActivate: editToken,
    onDeleteSelection: removeTokens,
    loadImage: imageUrl,
  });
  const inspector = createMapInspector({
    selectedTokens: () => {
      const ids = new Set(isMaster() ? stage.selection() : []);
      return controller.state.get().tokens.filter((token) => ids.has(token.id));
    },
    heroFor,
    heroActions,
    tokenLife: {
      adjust: (id, delta) =>
        controller.actions.adjustTokenLife(id, delta).catch((error) => showError(error, 'LeP nicht gespeichert')),
      set: (id, value) =>
        controller.actions.setTokenLife(id, value).catch((error) => showError(error, 'LeP nicht gespeichert')),
      setMax: (id, value) => run('LeP nicht gespeichert', () => controller.actions.editToken(id, { leMax: value })),
    },
    onEdit: editToken,
    onHide: (ids, hidden) => run('Nicht gespeichert', () => controller.actions.setTokensHidden(ids, hidden)),
    onRemove: removeTokens,
    onClose: () => stage.setSelection([]),
  });
  stage.element.append(inspector.element);

  // Spielbildschirm: links die Werte, in der Mitte die Karte, rechts die Proben.
  // Breit stehen die Seiten neben der Karte, am Handy kommen sie als Schublade (Knöpfe unten).
  const vitals = createVitalsPanel({ store, heroId: openHeroId, heroActions, onClose: () => openDrawer(null) });
  const checks = createChecksPanel({ store, openCheck, onClose: () => openDrawer(null) });
  const vitalsToggle = h('button', {
    type: 'button',
    class: 'play-toggle play-toggle-left',
    'aria-expanded': 'false',
    'aria-label': 'Werte (LeP, AsP …)',
    onclick: () => openDrawer(drawer === 'left' ? null : 'left'),
  });
  const checksToggle = h(
    'button',
    {
      type: 'button',
      class: 'play-toggle play-toggle-right',
      'aria-expanded': 'false',
      'aria-label': 'Proben',
      onclick: () => openDrawer(drawer === 'right' ? null : 'right'),
    },
    icon(ICONS.dice),
    h('span', {}, 'Proben'),
  );
  let drawer = null; // offene Schublade am Handy: 'left' | 'right' | null

  function openDrawer(side) {
    drawer = side;
    vitals.element.classList.toggle('is-open', side === 'left');
    checks.element.classList.toggle('is-open', side === 'right');
    vitalsToggle.setAttribute('aria-expanded', String(side === 'left'));
    checksToggle.setAttribute('aria-expanded', String(side === 'right'));
  }

  /** Seiten des Spielbildschirms und – beim Meister – das Panel der Auswahl unter der Karte. */
  function renderPanels() {
    inspector.render();
    const hasHero = Boolean(store.hero && openHeroId());
    game.classList.toggle('has-hero', hasHero);
    for (const element of [vitals.element, checks.element, vitalsToggle, checksToggle]) element.hidden = !hasHero;
    if (!hasHero) {
      openDrawer(null);
      return;
    }
    vitals.render();
    checks.render();
    setChildren(vitalsToggle, h('span', { class: 'play-toggle-label' }, poolSummary(store.hero)));
  }
  const tabStrip = h('div', { class: 'map-tabs', role: 'tablist', 'aria-label': 'Geöffnete Karten' });
  const toolbar = h('div', { class: 'map-toolbar' });
  const notice = h('div', { class: 'map-notice' });
  const message = h('div', { class: 'map-message' });
  const gridPanel = createGridPanel(controller, () => {
    renderToolbar(controller.viewMap());
    layout();
  });
  const center = h('div', { class: 'map-center' }, stage.element, message);
  const game = h('div', { class: 'map-game' }, vitals.element, center, checks.element, vitalsToggle, checksToggle);
  panel.append(tabStrip, toolbar, notice, gridPanel.element, game);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer && !document.querySelector('dialog[open]')) openDrawer(null);
  });

  async function run(label, action) {
    try {
      await action();
    } catch (error) {
      showError(error, label);
    }
  }

  const addHeroes = () =>
    run('Helden nicht aufgestellt', async () => {
      const created = await controller.actions.addHeroes(stage.visibleCenter());
      showToast(
        created.length
          ? `${created.length === 1 ? 'Ein Held steht' : `${created.length} Helden stehen`} jetzt auf der Karte.`
          : 'Alle Helden stehen schon auf der Karte.',
      );
    });

  function toolButton(label, onclick, { pressed = null } = {}) {
    return h(
      'button',
      {
        type: 'button',
        class: pressed ? 'btn active' : 'btn',
        'aria-pressed': pressed === null ? null : String(pressed),
        onclick,
      },
      label,
    );
  }

  /**
   * Baut einen Bereich nur neu, wenn sich sein Inhalt ändert. Live-Änderungen (z. B. eine
   * Figur, die jemand anderes zieht) sollen keinen Knopf austauschen, den man gerade antippt.
   */
  const renderedKeys = new Map();
  function changed(part, ...values) {
    const key = JSON.stringify(values);
    if (renderedKeys.get(part) === key) return false;
    renderedKeys.set(part, key);
    return true;
  }

  /** Spieler mit Held, dessen Figur noch nicht auf der gezeigten Karte steht. */
  function canPlaceOwnToken(map) {
    const heroId = openHeroId();
    return Boolean(
      map &&
      !isMaster() &&
      heroId &&
      store.hero &&
      !controller.state.get().tokens.some((token) => token.character_id === heroId),
    );
  }

  function placeOwnToken() {
    openOwnTokenDialog({ controller, heroName: heroName(store.hero), center: stage.visibleCenter });
  }

  function renderToolbar(map) {
    const hasHeroes = room.get().characters.length > 0;
    const canPlace = canPlaceOwnToken(map);
    if (!changed('toolbar', map?.id, map?.name, isMaster(), gridPanel.isOpen(), hasHeroes, canPlace)) return;
    if (!map) {
      setChildren(toolbar);
      return;
    }
    if (!isMaster()) {
      setChildren(
        toolbar,
        h('strong', { class: 'map-title' }, map.name || 'Karte'),
        canPlace
          ? h('button', { type: 'button', class: 'btn btn-primary', onclick: placeOwnToken }, 'Meine Figur aufstellen')
          : null,
      );
      return;
    }
    setChildren(
      toolbar,
      toolButton('Karten', () => openMapsDialog(controller)),
      toolButton('Raster', () => (gridPanel.isOpen() ? gridPanel.close() : gridPanel.open()), {
        pressed: gridPanel.isOpen(),
      }),
      toolButton('+ Figur', () =>
        openTokenDialog({ controller, token: null, characters: room.get().characters, center: stage.visibleCenter }),
      ),
      hasHeroes ? toolButton('Helden', addHeroes) : null,
    );
  }

  /**
   * Meister: mehrere Karten offen (Tabs). Die gezeigte Karte trägt ein Auge; die anderen lassen
   * sich bearbeiten und vorbereiten, während die Spieler weiter die gezeigte sehen.
   */
  function renderTabs(state) {
    const tabs = isMaster() ? mapTabs({ ...state, openIds: state.openMapIds }) : [];
    if (!changed('tabs', tabs, isMaster(), state.maps.length)) return;
    tabStrip.hidden = !isMaster() || state.maps.length === 0;
    if (tabStrip.hidden) return;
    setChildren(
      tabStrip,
      tabs.map((tab) =>
        h(
          'div',
          { class: `map-tab ${tab.viewing ? 'is-viewing' : ''} ${tab.shown ? 'is-shown' : ''}`.trim() },
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              class: 'map-tab-open',
              'aria-selected': String(tab.viewing),
              title: tab.shown ? 'Diese Karte sehen gerade alle' : 'Nur du siehst diese Karte',
              onclick: () => run('Karte nicht geöffnet', () => controller.actions.selectMap(tab.id)),
            },
            tab.shown ? h('span', { class: 'map-tab-eye', 'aria-label': 'alle sehen sie' }, '👁') : null,
            h('span', { class: 'map-tab-name' }, tab.name),
          ),
          tab.shown
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  class: 'map-tab-close',
                  'aria-label': `„${tab.name}“ schließen`,
                  onclick: () => run('Schließen fehlgeschlagen', () => controller.actions.closeMapTab(tab.id)),
                },
                '×',
              ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'map-tab-add',
          'aria-label': 'Weitere Karte öffnen oder hochladen',
          onclick: () => openMapsDialog(controller),
        },
        '+ Karte',
      ),
    );
  }

  function renderNotice(state, map) {
    const mine = state.tokens.some(canMove);
    const shownMap = state.maps.find((entry) => entry.id === state.activeMapId);
    if (!changed('notice', map?.id, map?.name, isMaster(), state.activeMapId, shownMap?.name, mine, openHeroId()))
      return;
    if (!map) {
      setChildren(notice);
      return;
    }
    if (isMaster()) {
      const shown = map.id === state.activeMapId;
      setChildren(
        notice,
        shown
          ? h(
              'p',
              { class: 'section-hint' },
              `„${map.name || 'Karte'}“ – alle sehen diese Karte. Figur antippen: Werte ändern, bearbeiten. Mehrere markieren: Rahmen ziehen (Maus) oder Knopf „Auswählen“ – dann gemeinsam ziehen.`,
            )
          : h(
              'div',
              { class: 'map-preview-note' },
              h(
                'span',
                {},
                'Vorbereitung: Nur du siehst diese Karte. ',
                shownMap
                  ? `Die Spieler sehen weiter „${shownMap.name || 'Karte'}“.`
                  : 'Die Spieler sehen gerade keine Karte.',
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-primary',
                  onclick: () => run('Zeigen fehlgeschlagen', () => controller.actions.showMap(map.id)),
                },
                'Allen zeigen',
              ),
            ),
      );
      return;
    }
    setChildren(
      notice,
      h(
        'p',
        { class: 'section-hint' },
        mine
          ? 'Ziehe deine Figur, um sie zu bewegen. Tippe sie an für deine Werte.'
          : openHeroId()
            ? 'Stell deine Figur mit „Meine Figur aufstellen“ auf die Karte – oder der Meister macht es.'
            : 'Lege im Tab „Held“ deinen Helden an, dann kannst du deine Figur aufstellen.',
      ),
    );
  }

  function renderMessage(state, map) {
    if (!changed('message', state.status, state.error, Boolean(map), isMaster())) return;
    if (map && state.status !== 'offline') {
      setChildren(message);
      return;
    }
    if (state.status === 'offline') {
      setChildren(
        message,
        h('p', { class: 'empty-hint' }, 'Keine Verbindung – die Karte ist wieder aktuell, sobald du online bist.'),
      );
      return;
    }
    if (state.status === 'error') {
      setChildren(
        message,
        h(
          'div',
          { class: 'card' },
          h('p', {}, state.error),
          h('button', { type: 'button', class: 'btn', onclick: () => controller.load() }, 'Erneut versuchen'),
        ),
      );
      return;
    }
    if (state.status !== 'ready') {
      setChildren(message, h('p', { class: 'loading' }, 'Karte wird geladen …'));
      return;
    }
    setChildren(
      message,
      isMaster()
        ? h(
            'div',
            { class: 'card map-empty' },
            h('h3', {}, 'Noch keine Karte'),
            h(
              'p',
              { class: 'section-hint' },
              'Lade ein Bild hoch (Dungeon, Taverne, Landkarte …). Du kannst es in Ruhe vorbereiten und dann allen zeigen.',
            ),
            h(
              'button',
              { type: 'button', class: 'btn btn-primary', onclick: () => openMapsDialog(controller) },
              'Karte hochladen',
            ),
          )
        : h('p', { class: 'empty-hint' }, 'Der Meister zeigt gerade keine Karte.'),
    );
  }

  function updateHighlight() {
    stage.setHighlight(tokensForTurn(controller.state.get().tokens, currentEntry(room.get().combat)));
  }

  /** Spielbildschirm füllt den Platz bis zur Tab-Leiste (im Vollbild die Karte den ganzen Bildschirm). */
  function layout() {
    if (panel.hidden || stage.element.classList.contains('is-fullscreen')) return;
    const top = game.getBoundingClientRect().top + window.scrollY;
    const tabBar = document.querySelector('.tab-bar')?.offsetHeight ?? 0;
    const height = `${Math.max(MIN_FRAME_HEIGHT, Math.round(window.innerHeight - top - tabBar - 12))}px`;
    if (game.style.height !== height) game.style.height = height;
  }

  function render() {
    const state = controller.state.get();
    const map = controller.viewMap();
    if (!map && gridPanel.isOpen()) gridPanel.close();
    renderTabs(state);
    renderToolbar(map);
    renderNotice(state, map);
    renderMessage(state, map);
    stage.element.hidden = !map;
    if (map) {
      stage.setMap(map, normalizeGrid(map.grid, map));
      stage.setTokens(state.tokens);
      updateHighlight();
      gridPanel.refresh();
    }
    renderPanels();
    layout();
  }

  controller.state.subscribe(render);
  room.subscribe(() => {
    updateHighlight();
    renderToolbar(controller.viewMap());
    renderPanels();
    stage.refresh(); // Lebensbalken der Helden
  });
  subscribeHero(() => {
    renderToolbar(controller.viewMap()); // „Meine Figur aufstellen“ erst mit Held
    renderNotice(controller.state.get(), controller.viewMap());
    renderPanels();
    stage.refresh();
  });
  // Nicht direkt im Beobachter die Höhe ändern (sonst meldet der Browser eine Endlosschleife).
  new ResizeObserver(() => requestAnimationFrame(layout)).observe(panel);
  window.addEventListener('resize', layout);
  render();
}
