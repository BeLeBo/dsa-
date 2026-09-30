/**
 * map-stage.js – Die Karte zum Anfassen: verschieben (ein Finger oder Maus), zoomen
 * (zwei Finger, Mausrad, Knöpfe), Figuren ziehen (Drag & Drop) und antippen.
 * Zeichnet Kartenbild, Raster und Figuren; kennt weder Server noch Rollen.
 */
import { h, icon, ICONS } from './dom.js';
import {
  fitView,
  zoomLimits,
  clampView,
  zoomAt,
  panBy,
  pinchView,
  screenToMap,
  snapToGrid,
  clampToMap,
  tokenDiameter,
  initials,
  TOKEN_COLORS,
} from '../map.js';

/** Ab dieser Bewegung (Bildschirmpunkte) ist es kein Antippen mehr. */
const DRAG_THRESHOLD_PX = 6;
const WHEEL_ZOOM_SPEED = 0.0015;
const BUTTON_ZOOM_FACTOR = 1.4;
/** Kleiner dargestellte Felder (Bildschirmpunkte): Namen nur noch bei wichtigen Figuren. */
const COMPACT_CELL_PX = 26;
/** Zu Beginn wird so weit vergrößert, dass die eigene Figur gut zu sehen ist. */
const READABLE_CELL_PX = 36;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** Raster als SVG-Muster über der Karte. */
function createGridLayer() {
  const patternId = `raster-${Math.random().toString(36).slice(2, 10)}`;
  const path = svg('path', { fill: 'none' });
  const pattern = svg('pattern', { id: patternId, patternUnits: 'userSpaceOnUse' });
  pattern.append(path);
  const defs = svg('defs');
  defs.append(pattern);
  const element = svg('svg', { class: 'map-grid', 'aria-hidden': 'true' });
  element.append(defs, svg('rect', { width: '100%', height: '100%', fill: `url(#${patternId})` }));

  function update(map, grid) {
    element.setAttribute('width', map.width);
    element.setAttribute('height', map.height);
    element.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
    element.style.display = grid.show ? '' : 'none';
    element.dataset.color = grid.color;
    for (const [key, value] of Object.entries({
      width: grid.size,
      height: grid.size,
      x: grid.offsetX,
      y: grid.offsetY,
    })) {
      pattern.setAttribute(key, value);
    }
    path.setAttribute('d', `M ${grid.size} 0 L 0 0 0 ${grid.size}`);
  }
  return { element, update };
}

const colorValue = (id) => (TOKEN_COLORS.find((color) => color.id === id) ?? TOKEN_COLORS[0]).value;

const localPoint = (element, event) => {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pinchInfo([a, b]) {
  return { distance: distance(a, b), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/**
 * @param {object} options
 * @param {(token: object) => boolean} options.canMove  darf dieses Gerät die Figur ziehen?
 * @param {(token: object) => boolean} options.isMine   eigene Figur (Spieler) – anfangs im Blick
 * @param {(tokenId: string, point: {x, y}) => void} options.onMove  Figur abgelegt (eingerastet)
 * @param {(token: object) => void} options.onTap       Figur angetippt
 * @param {(path: string) => Promise<string>} options.loadImage  Bildadresse zu einem Speicherpfad
 */
export function createMapStage({ canMove, isMine, onMove, onTap, loadImage }) {
  const image = h('img', { class: 'map-image', alt: '', draggable: 'false' });
  const grid = createGridLayer();
  const tokenLayer = h('div', { class: 'map-tokens' });
  const stage = h('div', { class: 'map-stage' }, image, grid.element, tokenLayer);
  const status = h('div', { class: 'map-status', role: 'status' });
  const viewport = h('div', { class: 'map-viewport' }, stage, status);
  const fullscreenButton = h(
    'button',
    {
      type: 'button',
      class: 'map-control',
      'aria-label': 'Vollbild',
      'aria-pressed': 'false',
      onclick: toggleFullscreen,
    },
    icon(ICONS.expand),
  );
  const controls = h(
    'div',
    { class: 'map-controls' },
    h(
      'button',
      { type: 'button', class: 'map-control', 'aria-label': 'Vergrößern', onclick: () => zoomBy(BUTTON_ZOOM_FACTOR) },
      icon(ICONS.plus),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'map-control',
        'aria-label': 'Verkleinern',
        onclick: () => zoomBy(1 / BUTTON_ZOOM_FACTOR),
      },
      icon(ICONS.minus),
    ),
    h(
      'button',
      { type: 'button', class: 'map-control', 'aria-label': 'Ganze Karte zeigen', onclick: fit },
      icon(ICONS.fit),
    ),
    fullscreenButton,
  );
  const element = h('div', { class: 'map-frame' }, viewport, controls);

  let map = null;
  let gridValues = null;
  let view = { x: 0, y: 0, scale: 1 };
  let fitted = false;
  let userMoved = false;
  let lastSize = null;
  let tokens = [];
  let highlighted = new Set();
  let gesture = null;
  const pointers = new Map();
  const tokenViews = new Map();

  // -------------------------------------------------------------------------
  // Ansicht
  // -------------------------------------------------------------------------

  const viewportSize = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
  const hasSize = () => viewport.clientWidth > 0 && viewport.clientHeight > 0;

  function applyView() {
    if (!map || !hasSize()) return;
    view = clampView(view, viewportSize(), map);
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    stage.style.setProperty('--inverse-scale', String(1 / view.scale));
    stage.classList.toggle('is-compact', Boolean(gridValues) && gridValues.size * view.scale < COMPACT_CELL_PX);
  }

  /** Ganze Karte zeigen (Knopf). */
  function fit() {
    if (!map || !hasSize()) return;
    view = fitView(viewportSize(), map);
    fitted = true;
    userMoved = true;
    applyView();
  }

  /**
   * Startansicht: ganze Karte – sind die Felder dabei winzig und gibt es eigene Figuren,
   * wird auf sie vergrößert. Gilt nur, bis man selbst verschiebt oder zoomt.
   */
  function showStart() {
    if (!map || !hasSize()) return;
    const size = viewportSize();
    const whole = fitView(size, map);
    const mine = tokens.filter(isMine);
    const readable = READABLE_CELL_PX / (gridValues?.size ?? 1);
    fitted = true;
    if (mine.length === 0 || whole.scale >= readable) {
      view = whole;
    } else {
      const center = {
        x: mine.reduce((sum, token) => sum + token.x, 0) / mine.length,
        y: mine.reduce((sum, token) => sum + token.y, 0) / mine.length,
      };
      const scale = Math.min(zoomLimits(size, map).max, readable);
      view = { scale, x: size.width / 2 - center.x * scale, y: size.height / 2 - center.y * scale };
    }
    applyView();
  }

  function zoomBy(factor, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    if (!map || !hasSize()) return;
    userMoved = true;
    view = zoomAt(view, factor, point, zoomLimits(viewportSize(), map));
    applyView();
  }

  /** Größenänderung (Drehen, Vollbild): Die Mitte des Ausschnitts bleibt, wo sie ist. */
  function onResize() {
    if (!hasSize()) return;
    const size = viewportSize();
    if (!fitted) showStart();
    else if (lastSize) view = panBy(view, (size.width - lastSize.width) / 2, (size.height - lastSize.height) / 2);
    lastSize = size;
    applyView();
  }

  function toggleFullscreen() {
    const active = element.classList.toggle('is-fullscreen');
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', active ? 'Vollbild beenden' : 'Vollbild');
    document.body.classList.toggle('map-fullscreen-open', active);
  }

  new ResizeObserver(onResize).observe(viewport);

  // -------------------------------------------------------------------------
  // Figuren
  // -------------------------------------------------------------------------

  function renderFace(entry, token) {
    if (entry.imagePath === token.image_path && entry.label === token.name) return;
    entry.imagePath = token.image_path;
    entry.label = token.name;
    const text = initials(token.name);
    const fallback = h('span', { class: 'map-token-initials', dataset: { length: String(text.length) } }, text);
    entry.face.replaceChildren(fallback);
    if (!token.image_path) return;
    const path = token.image_path;
    loadImage(path)
      .then((url) => {
        if (entry.imagePath !== path) return; // inzwischen anderes Bild
        entry.face.replaceChildren(h('img', { src: url, alt: '', draggable: 'false' }));
      })
      .catch(() => {}); // Kürzel bleibt stehen
  }

  function placeToken(entry, point, diameter) {
    entry.element.style.transform = `translate(${point.x - diameter / 2}px, ${point.y - diameter / 2}px)`;
  }

  function updateToken(entry, token) {
    const diameter = tokenDiameter(token.size, gridValues);
    entry.token = token;
    entry.element.style.width = `${diameter}px`;
    entry.element.style.height = `${diameter}px`;
    entry.element.style.setProperty('--token-color', colorValue(token.color));
    entry.element.style.setProperty('--token-size', `${diameter}px`);
    if (gesture?.kind !== 'drag' || gesture.tokenId !== token.id) placeToken(entry, token, diameter);
    entry.element.classList.toggle('is-hidden', token.hidden === true);
    entry.element.classList.toggle('is-movable', canMove(token));
    entry.element.classList.toggle('is-mine', isMine(token));
    entry.element.classList.toggle('is-turn', highlighted.has(token.id));
    entry.name.textContent = token.name;
    entry.element.setAttribute('aria-label', `${token.name}${token.hidden ? ' (verborgen)' : ''}`);
    renderFace(entry, token);
  }

  function createTokenView(token) {
    const face = h('span', { class: 'map-token-face' });
    const name = h('span', { class: 'map-token-name' });
    const tokenElement = h(
      'div',
      { class: 'map-token', role: 'button', tabindex: '0', dataset: { tokenId: token.id } },
      face,
      name,
    );
    return { element: tokenElement, face, name, token, imagePath: undefined, label: undefined };
  }

  function renderTokens() {
    if (!gridValues) return;
    const ids = new Set(tokens.map((token) => token.id));
    for (const [id, entry] of tokenViews) {
      if (!ids.has(id)) {
        entry.element.remove();
        tokenViews.delete(id);
      }
    }
    for (const token of tokens) {
      let entry = tokenViews.get(token.id);
      if (!entry) {
        entry = createTokenView(token);
        tokenViews.set(token.id, entry);
      }
      updateToken(entry, token);
      tokenLayer.append(entry.element); // Reihenfolge = Stapel: zuletzt bewegte oben
    }
  }

  const tokenById = (id) => tokens.find((token) => token.id === id) ?? null;

  // -------------------------------------------------------------------------
  // Gesten: verschieben, zoomen, Figuren ziehen
  // -------------------------------------------------------------------------

  function dropToken(entry, point) {
    const target = clampToMap(snapToGrid(point, entry.token.size, gridValues), map);
    placeToken(entry, target, tokenDiameter(entry.token.size, gridValues));
    onMove(entry.token.id, target);
  }

  function startPointer(event, point) {
    const tokenElement = event.target.closest('.map-token');
    const token = tokenElement ? tokenById(tokenElement.dataset.tokenId) : null;
    if (token && canMove(token)) {
      const pointer = screenToMap(view, point);
      gesture = {
        kind: 'drag',
        tokenId: token.id,
        start: point,
        moved: false,
        grab: { x: token.x - pointer.x, y: token.y - pointer.y },
        position: { x: token.x, y: token.y },
      };
    } else {
      gesture = { kind: 'pan', start: point, last: point, moved: false, tapToken: token };
    }
  }

  function cancelDrag() {
    const entry = tokenViews.get(gesture.tokenId);
    entry?.element.classList.remove('is-dragging');
    if (entry) updateToken(entry, entry.token);
  }

  function onPointerDown(event) {
    if (!map || (event.pointerType === 'mouse' && event.button !== 0) || status.contains(event.target)) return;
    event.preventDefault();
    viewport.setPointerCapture?.(event.pointerId);
    const point = localPoint(viewport, event);
    pointers.set(event.pointerId, point);
    userMoved = true;
    if (pointers.size === 1) {
      startPointer(event, point);
    } else if (pointers.size === 2) {
      if (gesture?.kind === 'drag') cancelDrag();
      gesture = { kind: 'pinch', startView: view, start: pinchInfo([...pointers.values()]) };
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = localPoint(viewport, event);
    pointers.set(event.pointerId, point);
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      view = pinchView(
        gesture.startView,
        gesture.start,
        pinchInfo([...pointers.values()]),
        zoomLimits(viewportSize(), map),
      );
      applyView();
      return;
    }
    if (!gesture.moved && distance(point, gesture.start) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      view = panBy(view, point.x - gesture.last.x, point.y - gesture.last.y);
      gesture.last = point;
      applyView();
    } else if (gesture.kind === 'drag') {
      const entry = tokenViews.get(gesture.tokenId);
      const pointer = screenToMap(view, point);
      gesture.position = clampToMap({ x: pointer.x + gesture.grab.x, y: pointer.y + gesture.grab.y }, map);
      entry.element.classList.add('is-dragging');
      placeToken(entry, gesture.position, tokenDiameter(entry.token.size, gridValues));
    }
  }

  function onPointerEnd(event) {
    if (!pointers.delete(event.pointerId) || !gesture) return;
    const finished = gesture;
    if (finished.kind === 'pinch') {
      // Ein Finger bleibt liegen: nahtlos weiter verschieben (kein Antippen).
      const remaining = [...pointers.values()][0];
      gesture = remaining ? { kind: 'pan', start: remaining, last: remaining, moved: true, tapToken: null } : null;
      return;
    }
    if (pointers.size > 0) return;
    gesture = null;
    if (finished.kind === 'drag') {
      const entry = tokenViews.get(finished.tokenId);
      entry?.element.classList.remove('is-dragging');
      if (!entry) return;
      if (finished.moved && event.type !== 'pointercancel') dropToken(entry, finished.position);
      else if (finished.moved) updateToken(entry, entry.token);
      else onTap(entry.token);
    } else if (!finished.moved && finished.tapToken) {
      onTap(finished.tapToken);
    }
  }

  function onWheel(event) {
    if (!map) return;
    event.preventDefault();
    const speed = event.deltaMode === 1 ? WHEEL_ZOOM_SPEED * 20 : WHEEL_ZOOM_SPEED;
    zoomBy(Math.exp(-event.deltaY * speed), localPoint(viewport, event));
  }

  /** Tastatur: Pfeiltasten bewegen die Figur um ein Feld, Enter/Leertaste tippt sie an. */
  function onKeyDown(event) {
    const tokenElement = event.target.closest('.map-token');
    const entry = tokenElement && tokenViews.get(tokenElement.dataset.tokenId);
    if (!entry) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onTap(entry.token);
      return;
    }
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!steps || !canMove(entry.token)) return;
    event.preventDefault();
    const step = gridValues.size;
    dropToken(entry, { x: entry.token.x + steps[0] * step, y: entry.token.y + steps[1] * step });
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  tokenLayer.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape' && element.classList.contains('is-fullscreen')) toggleFullscreen();
  });

  // -------------------------------------------------------------------------
  // Kartenbild
  // -------------------------------------------------------------------------

  function showStatus(text, retry = null) {
    status.replaceChildren(
      h('span', {}, text),
      retry ? h('button', { type: 'button', class: 'btn btn-small', onclick: retry }, 'Erneut versuchen') : '',
    );
    status.hidden = !text;
  }

  function loadMapImage(current) {
    // Die Karte kann inzwischen als neues Objekt (Live-Änderung) oder als andere Karte vorliegen.
    const stillCurrent = () => map?.id === current.id && map.image_path === current.image_path;
    showStatus('Karte wird geladen …');
    image.removeAttribute('src');
    loadImage(current.image_path)
      .then((url) => {
        if (!stillCurrent()) return;
        image.src = url;
        return image.decode().then(() => stillCurrent() && showStatus(''));
      })
      .catch((error) => {
        if (stillCurrent()) showStatus(`Kartenbild nicht geladen: ${error.message}`, () => loadMapImage(current));
      });
  }

  return {
    element,
    /** Neue oder geänderte Karte (Raster als normalisierte Werte). */
    setMap(nextMap, nextGrid) {
      const changedImage = !map || map.id !== nextMap.id || map.image_path !== nextMap.image_path;
      map = nextMap;
      gridValues = nextGrid;
      stage.style.width = `${map.width}px`;
      stage.style.height = `${map.height}px`;
      image.width = map.width;
      image.height = map.height;
      grid.update(map, gridValues);
      if (changedImage) {
        fitted = false;
        userMoved = false;
        loadMapImage(map);
        showStart();
      }
      renderTokens();
      applyView();
    },
    setTokens(nextTokens) {
      const hadMine = tokens.some(isMine);
      tokens = nextTokens;
      renderTokens();
      if (!userMoved && !hadMine && tokens.some(isMine)) showStart(); // eigene Figur ist dazugekommen
    },
    /** Figuren, die gerade am Zug sind, hervorheben. */
    setHighlight(ids) {
      highlighted = new Set(ids);
      for (const entry of tokenViews.values())
        entry.element.classList.toggle('is-turn', highlighted.has(entry.token.id));
    },
    /** Mitte des sichtbaren Ausschnitts in Kartenpunkten (zum Aufstellen neuer Figuren). */
    visibleCenter() {
      if (!map || !hasSize()) return { x: (map?.width ?? 0) / 2, y: (map?.height ?? 0) / 2 };
      return clampToMap(screenToMap(view, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }), map);
    },
    fit,
  };
}
