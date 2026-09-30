/**
 * map-view.js – Tab „Karte“ im Raum: die Karte mit allen Figuren, live für alle.
 * Meister: Karten verwalten, Raster einstellen, Figuren aufstellen und bearbeiten.
 * Spieler: sehen die gezeigte Karte und ziehen die Figur ihres Helden.
 */
import { h, setChildren } from './dom.js';
import { showToast, showError } from './toast.js';
import { segmentedControl } from './segmented.js';
import { createMapStage } from './map-stage.js';
import { openMapsDialog, openTokenDialog } from './map-dialogs.js';
import { imageUrl } from '../map-api.js';
import { currentEntry } from '../combat.js';
import {
  normalizeGrid,
  gridSizeFromCells,
  cellsAcross,
  tokensForTurn,
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
 */
export function createMapView(panel, { controller, room, isMaster, myCharacterId }) {
  const canMove = (token) => isMaster() || (Boolean(token.character_id) && token.character_id === myCharacterId());
  const stage = createMapStage({
    canMove,
    isMine: (token) => !isMaster() && canMove(token),
    onMove: (tokenId, point) =>
      controller.actions.moveToken(tokenId, point).catch((error) => showError(error, 'Figur nicht bewegt')),
    onTap: (token) => {
      if (isMaster())
        openTokenDialog({ controller, token, characters: room.get().characters, center: stage.visibleCenter });
    },
    loadImage: imageUrl,
  });
  const toolbar = h('div', { class: 'map-toolbar' });
  const notice = h('div', { class: 'map-notice' });
  const message = h('div', { class: 'map-message' });
  const gridPanel = createGridPanel(controller, () => {
    renderToolbar(controller.viewMap());
    layout();
  });
  panel.append(toolbar, notice, gridPanel.element, stage.element, message);

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

  function renderToolbar(map) {
    const hasHeroes = room.get().characters.length > 0;
    if (!changed('toolbar', map?.id, map?.name, isMaster(), gridPanel.isOpen(), hasHeroes)) return;
    if (!map) {
      setChildren(toolbar);
      return;
    }
    if (!isMaster()) {
      setChildren(toolbar, h('strong', { class: 'map-title' }, map.name || 'Karte'));
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

  function renderNotice(state, map) {
    const mine = state.tokens.some(canMove);
    if (!changed('notice', map?.id, map?.name, isMaster(), state.activeMapId, mine)) return;
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
              `„${map.name || 'Karte'}“ – alle sehen diese Karte. Tippe eine Figur an, um sie zu bearbeiten.`,
            )
          : h(
              'div',
              { class: 'map-preview-note' },
              h('span', {}, 'Vorbereitung: Nur du siehst diese Karte.'),
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
        mine ? 'Ziehe deine Figur, um sie zu bewegen.' : 'Deine Figur stellt der Meister auf die Karte.',
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

  /** Karte füllt den Platz bis zur Tab-Leiste (im Vollbild den ganzen Bildschirm). */
  function layout() {
    const frame = stage.element;
    if (panel.hidden || frame.hidden || frame.classList.contains('is-fullscreen')) return;
    const top = frame.getBoundingClientRect().top + window.scrollY;
    const tabBar = document.querySelector('.tab-bar')?.offsetHeight ?? 0;
    const height = `${Math.max(MIN_FRAME_HEIGHT, Math.round(window.innerHeight - top - tabBar - 12))}px`;
    if (frame.style.height !== height) frame.style.height = height;
  }

  function render() {
    const state = controller.state.get();
    const map = controller.viewMap();
    if (!map && gridPanel.isOpen()) gridPanel.close();
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
    layout();
  }

  controller.state.subscribe(render);
  room.subscribe(() => {
    updateHighlight();
    renderToolbar(controller.viewMap());
  });
  // Nicht direkt im Beobachter die Höhe ändern (sonst meldet der Browser eine Endlosschleife).
  new ResizeObserver(() => requestAnimationFrame(layout)).observe(panel);
  window.addEventListener('resize', layout);
  render();
}
