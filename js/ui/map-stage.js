/**
 * map-stage.js – Die Karte zum Anfassen: verschieben, zoomen (zwei Finger, Mausrad, Knöpfe),
 * Figuren ziehen und – für den Meister – Figuren auswählen wie am Desktop:
 *  - Antippen wählt eine Figur, Strg/Umschalt + Antippen fügt hinzu oder nimmt heraus.
 *  - Rahmen aufziehen (Maus: linke Taste auf freier Fläche, Handy: Knopf „Auswählen“).
 *  - Ausgewählte Figuren ziehen: alle wandern mit, die Formation bleibt.
 *  - Karte verschieben: Finger, rechte/mittlere Maustaste oder Leertaste + Maus.
 *
 * Kartenbild und Raster werden mit der Karte skaliert; die Figuren liegen in einer eigenen
 * Ebene in Bildschirmgröße darüber – so bleiben Namen, Kürzel und Bilder bei jedem Zoom scharf.
 * Kennt weder Server noch Rollen.
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
  mapToScreen,
  clampToMap,
  tokenDiameter,
  initials,
  normalizeRect,
  tokensInRect,
  moveGroup,
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
const ARROW_STEPS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] });

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

const isTyping = (target) => target instanceof Element && Boolean(target.closest('input, textarea, select'));

/**
 * @param {object} options
 * @param {(token: object) => boolean} options.canMove  darf dieses Gerät die Figur ziehen?
 * @param {(token: object) => boolean} options.isMine   eigene Figur (Spieler) – anfangs im Blick
 * @param {() => boolean} options.selectable            Auswahl erlaubt (Meister)?
 * @param {(moves: {id, x, y}[]) => void} options.onMove  Figuren abgelegt (eingerastet)
 * @param {(ids: string[]) => void} options.onSelect      Auswahl hat sich geändert
 * @param {(token: object) => void} options.onTap         Figur angetippt, ohne Auswahl (Spieler)
 * @param {(token: object) => void} options.onActivate    Enter auf einer Figur (Tastatur)
 * @param {(ids: string[]) => void} options.onDeleteSelection  Entf-Taste bei Auswahl
 * @param {(path: string) => Promise<string>} options.loadImage  Bildadresse zu einem Speicherpfad
 */
export function createMapStage({
  canMove,
  isMine,
  selectable = () => false,
  onMove,
  onSelect = () => {},
  onTap = () => {},
  onActivate = () => {},
  onDeleteSelection = () => {},
  loadImage,
}) {
  const image = h('img', { class: 'map-image', alt: '', draggable: 'false' });
  const grid = createGridLayer();
  const stage = h('div', { class: 'map-stage' }, image, grid.element);
  const tokenLayer = h('div', { class: 'map-tokens' });
  const marquee = h('div', { class: 'map-marquee', hidden: true });
  const status = h('div', { class: 'map-status', role: 'status' });
  const viewport = h('div', { class: 'map-viewport', tabindex: '-1' }, stage, tokenLayer, marquee, status);

  const controlButton = (label, path, onclick, extra = {}) =>
    h('button', { type: 'button', class: 'map-control', 'aria-label': label, onclick, ...extra }, icon(path));
  const selectButton = controlButton('Auswählen (Rahmen ziehen)', ICONS.select, toggleSelectMode, {
    'aria-pressed': 'false',
    hidden: true,
  });
  const fullscreenButton = controlButton('Vollbild', ICONS.expand, toggleFullscreen, { 'aria-pressed': 'false' });
  const controls = h(
    'div',
    { class: 'map-controls' },
    controlButton('Vergrößern', ICONS.plus, () => zoomBy(BUTTON_ZOOM_FACTOR)),
    controlButton('Verkleinern', ICONS.minus, () => zoomBy(1 / BUTTON_ZOOM_FACTOR)),
    controlButton('Ganze Karte zeigen', ICONS.fit, () => fit()),
    selectButton,
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
  let selected = new Set();
  let selectMode = false;
  let spaceDown = false;
  let gesture = null;
  const pointers = new Map();
  const tokenViews = new Map();

  const tokenById = (id) => tokens.find((token) => token.id === id) ?? null;

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
    tokenLayer.classList.toggle('is-compact', Boolean(gridValues) && gridValues.size * view.scale < COMPACT_CELL_PX);
    for (const entry of tokenViews.values()) placeToken(entry);
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
    const shrunk = lastSize && size.height < lastSize.height;
    lastSize = size;
    applyView();
    if (shrunk) revealSelection(); // z. B. das Panel des Meisters ist unter der Karte aufgegangen
  }

  /** Schiebt die Karte so, dass die ausgewählten Figuren (samt Namen) zu sehen sind. */
  function revealSelection() {
    if (!map || !gridValues || gesture || selected.size === 0) return;
    const margin = 8;
    const nameSpace = 18;
    let box = null;
    for (const id of selected) {
      const entry = tokenViews.get(id);
      if (!entry) continue;
      const center = mapToScreen(view, entry.position);
      const radius = (tokenDiameter(entry.token.size, gridValues) * view.scale) / 2 + margin;
      const bounds = {
        left: center.x - radius,
        right: center.x + radius,
        top: center.y - radius,
        bottom: center.y + radius + nameSpace,
      };
      box = box
        ? {
            left: Math.min(box.left, bounds.left),
            right: Math.max(box.right, bounds.right),
            top: Math.min(box.top, bounds.top),
            bottom: Math.max(box.bottom, bounds.bottom),
          }
        : bounds;
    }
    if (!box) return;
    const size = viewportSize();
    // Passt nicht alles hinein, bleibt der Anfang (links/oben) sichtbar.
    const shift = (low, high, length) => (low < 0 || high - low > length ? -low : high > length ? length - high : 0);
    const dx = shift(box.left, box.right, size.width);
    const dy = shift(box.top, box.bottom, size.height);
    if (dx === 0 && dy === 0) return;
    view = panBy(view, dx, dy);
    applyView();
  }

  function toggleFullscreen() {
    const active = element.classList.toggle('is-fullscreen');
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', active ? 'Vollbild beenden' : 'Vollbild');
    document.body.classList.toggle('map-fullscreen-open', active);
  }

  /** Handy/Tablet: Ein Finger zieht dann einen Auswahlrahmen statt die Karte zu verschieben. */
  function toggleSelectMode() {
    selectMode = !selectMode;
    selectButton.setAttribute('aria-pressed', String(selectMode));
    viewport.classList.toggle('is-select-mode', selectMode);
  }

  new ResizeObserver(onResize).observe(viewport);

  // -------------------------------------------------------------------------
  // Figuren (Ebene in Bildschirmgröße)
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

  /** Setzt eine Figur an ihre Position (entry.position in Kartenpunkten) auf dem Bildschirm. */
  function placeToken(entry) {
    if (!gridValues) return;
    const diameter = tokenDiameter(entry.token.size, gridValues) * view.scale;
    const center = mapToScreen(view, entry.position);
    entry.element.style.width = `${diameter}px`;
    entry.element.style.height = `${diameter}px`;
    entry.element.style.setProperty('--token-size', `${diameter}px`);
    entry.element.style.transform = `translate(${center.x - diameter / 2}px, ${center.y - diameter / 2}px)`;
  }

  const isDragged = (id) => gesture?.kind === 'token' && gesture.moved && gesture.group.includes(id);

  function updateToken(entry, token) {
    entry.token = token;
    if (!isDragged(token.id)) entry.position = { x: token.x, y: token.y };
    entry.element.style.setProperty('--token-color', colorValue(token.color));
    entry.element.classList.toggle('is-hidden', token.hidden === true);
    entry.element.classList.toggle('is-movable', canMove(token));
    entry.element.classList.toggle('is-mine', isMine(token));
    entry.element.classList.toggle('is-turn', highlighted.has(token.id));
    entry.element.classList.toggle('is-selected', selected.has(token.id));
    if (selectable()) entry.element.setAttribute('aria-pressed', String(selected.has(token.id)));
    else entry.element.removeAttribute('aria-pressed');
    entry.name.textContent = token.name;
    entry.element.setAttribute('aria-label', `${token.name}${token.hidden ? ' (verborgen)' : ''}`);
    renderFace(entry, token);
    placeToken(entry);
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
    return { element: tokenElement, face, name, token, position: { x: token.x, y: token.y } };
  }

  function renderTokens() {
    if (!gridValues) return;
    const focused = document.activeElement;
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
    // Umsortieren nimmt den Fokus weg – für die Bedienung per Tastatur zurückgeben.
    if (focused !== document.activeElement && tokenLayer.contains(focused)) focused.focus({ preventScroll: true });
  }

  // -------------------------------------------------------------------------
  // Auswahl
  // -------------------------------------------------------------------------

  function setSelection(ids) {
    const next = new Set(ids.filter((id) => tokenViews.has(id)));
    const changed = next.size !== selected.size || [...next].some((id) => !selected.has(id));
    selected = next;
    tokenLayer.classList.toggle('has-group', selected.size > 1);
    for (const entry of tokenViews.values())
      entry.element.classList.toggle('is-selected', selected.has(entry.token.id));
    if (changed) onSelect([...selected]);
  }

  const toggleSelected = (id) =>
    setSelection(selected.has(id) ? [...selected].filter((other) => other !== id) : [...selected, id]);

  // -------------------------------------------------------------------------
  // Gesten: verschieben, zoomen, Rahmen, Figuren ziehen
  // -------------------------------------------------------------------------

  function dropTokens(moves) {
    for (const move of moves) {
      const entry = tokenViews.get(move.id);
      if (!entry) continue;
      entry.position = { x: move.x, y: move.y };
      placeToken(entry);
    }
    onMove(moves);
  }

  /** Bewegt eine Gruppe um ganze Felder (Pfeiltasten). */
  function stepTokens(ids, [dx, dy]) {
    const group = ids.map(tokenById).filter((token) => token && canMove(token));
    if (group.length === 0) return;
    const [leader] = group;
    const target = { x: leader.x + dx * gridValues.size, y: leader.y + dy * gridValues.size };
    dropTokens(moveGroup(group, leader.id, target, gridValues, map));
  }

  function startGesture(event, point) {
    const isMouse = event.pointerType === 'mouse';
    const panButton = isMouse && (event.button === 1 || event.button === 2 || spaceDown);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey || selectMode;
    const tokenElement = panButton ? null : event.target.closest('.map-token');
    const token = tokenElement ? tokenById(tokenElement.dataset.tokenId) : null;

    if (token && (selectable() || canMove(token))) {
      const pointer = screenToMap(view, point);
      gesture = {
        kind: 'token',
        token,
        additive,
        start: point,
        moved: false,
        grab: { x: token.x - pointer.x, y: token.y - pointer.y },
        group: [],
      };
      return;
    }
    if (selectable() && !panButton && (isMouse ? event.button === 0 : selectMode)) {
      gesture = { kind: 'marquee', start: point, current: point, additive, moved: false };
      return;
    }
    gesture = { kind: 'pan', start: point, last: point, moved: false };
  }

  /** Beim ersten Ziehen einer Figur: Auswahl festlegen und die mitwandernde Gruppe bestimmen. */
  function beginTokenDrag() {
    const { token, additive } = gesture;
    if (selectable() && !selected.has(token.id)) {
      setSelection(additive ? [...selected, token.id] : [token.id]);
    }
    const ids = selectable() ? [...selected] : [token.id];
    gesture.group = ids.filter((id) => {
      const member = tokenById(id);
      return member && canMove(member);
    });
    gesture.origins = new Map(gesture.group.map((id) => [id, { ...tokenById(id) }]));
    for (const id of gesture.group) tokenViews.get(id)?.element.classList.add('is-dragging');
  }

  function dragTo(point) {
    const pointer = screenToMap(view, point);
    const leader = gesture.origins.get(gesture.token.id);
    if (!leader) return;
    const target = clampToMap({ x: pointer.x + gesture.grab.x, y: pointer.y + gesture.grab.y }, map);
    gesture.target = target;
    const dx = target.x - leader.x;
    const dy = target.y - leader.y;
    for (const [id, origin] of gesture.origins) {
      const entry = tokenViews.get(id);
      if (!entry) continue;
      entry.position = clampToMap({ x: origin.x + dx, y: origin.y + dy }, map);
      placeToken(entry);
    }
  }

  function endDragVisuals(group) {
    for (const id of group) tokenViews.get(id)?.element.classList.remove('is-dragging');
  }

  function cancelTokenDrag() {
    const group = gesture.group;
    gesture = null;
    endDragVisuals(group);
    for (const id of group) {
      const entry = tokenViews.get(id);
      if (entry) updateToken(entry, entry.token);
    }
  }

  function tapToken({ token, additive }) {
    if (!selectable()) {
      onTap(token);
      return;
    }
    if (additive) toggleSelected(token.id);
    else setSelection([token.id]);
  }

  function finishMarquee(finished) {
    marquee.hidden = true;
    if (!finished.moved) {
      if (!finished.additive) setSelection([]);
      return;
    }
    const rect = normalizeRect(screenToMap(view, finished.start), screenToMap(view, finished.current));
    const inside = tokensInRect(tokens, rect, gridValues);
    setSelection(finished.additive ? [...new Set([...selected, ...inside])] : inside);
  }

  function onPointerDown(event) {
    if (!map || status.contains(event.target)) return;
    if (event.pointerType === 'mouse' && event.button > 2) return;
    event.preventDefault();
    (event.target.closest('.map-token') ?? viewport).focus({ preventScroll: true });
    viewport.setPointerCapture?.(event.pointerId);
    const point = localPoint(viewport, event);
    pointers.set(event.pointerId, point);
    userMoved = true;
    if (pointers.size === 1) {
      startGesture(event, point);
    } else if (pointers.size === 2) {
      if (gesture?.kind === 'token' && gesture.moved) cancelTokenDrag();
      marquee.hidden = true;
      gesture = { kind: 'pinch', startView: view, start: pinchInfo([...pointers.values()]) };
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = localPoint(viewport, event);
    pointers.set(event.pointerId, point);
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) return;
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
    const firstMove = !gesture.moved;
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      view = panBy(view, point.x - gesture.last.x, point.y - gesture.last.y);
      gesture.last = point;
      applyView();
    } else if (gesture.kind === 'marquee') {
      gesture.current = point;
      const rect = normalizeRect(gesture.start, point);
      Object.assign(marquee.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
      });
      marquee.hidden = false;
    } else if (gesture.kind === 'token') {
      if (firstMove) beginTokenDrag();
      if (gesture.group.length) dragTo(point);
    }
  }

  function onPointerEnd(event) {
    if (!pointers.delete(event.pointerId) || !gesture) return;
    const finished = gesture;
    if (finished.kind === 'pinch') {
      // Ein Finger bleibt liegen: nahtlos weiter verschieben (kein Antippen).
      const remaining = [...pointers.values()][0];
      gesture = remaining ? { kind: 'pan', start: remaining, last: remaining, moved: true } : null;
      return;
    }
    if (pointers.size > 0) return;
    gesture = null;
    const cancelled = event.type === 'pointercancel';
    if (finished.kind === 'marquee') {
      if (!cancelled) finishMarquee(finished);
      else marquee.hidden = true;
    } else if (finished.kind === 'token') {
      endDragVisuals(finished.group);
      if (!finished.moved) {
        tapToken(finished);
      } else if (finished.group.length && finished.target && !cancelled) {
        const group = finished.group.map((id) => finished.origins.get(id));
        dropTokens(moveGroup(group, finished.token.id, finished.target, gridValues, map));
      } else {
        for (const id of finished.group) {
          const entry = tokenViews.get(id);
          if (entry) updateToken(entry, entry.token);
        }
      }
    } else if (finished.kind === 'pan' && !finished.moved && selectable() && !selectMode) {
      setSelection([]); // Tipp auf freie Fläche hebt die Auswahl auf
    }
  }

  function onWheel(event) {
    if (!map) return;
    event.preventDefault();
    const speed = event.deltaMode === 1 ? WHEEL_ZOOM_SPEED * 20 : WHEEL_ZOOM_SPEED;
    zoomBy(Math.exp(-event.deltaY * speed), localPoint(viewport, event));
  }

  /**
   * Tastatur: Pfeiltasten bewegen die Figur (bzw. alle ausgewählten) um ein Feld,
   * Enter öffnet, Esc hebt die Auswahl auf, Entf entfernt die ausgewählten (Meister).
   */
  function onKeyDown(event) {
    if (!map || isTyping(event.target)) return;
    const tokenElement = event.target.closest?.('.map-token');
    const entry = tokenElement && tokenViews.get(tokenElement.dataset.tokenId);
    if (event.key === 'Escape' && selected.size) {
      event.preventDefault();
      event.stopPropagation(); // erst die Auswahl aufheben, beim nächsten Esc das Vollbild beenden
      setSelection([]);
      return;
    }
    if (!viewport.contains(event.target)) return; // z. B. Knöpfe im Panel des Meisters
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectable() && selected.size) {
      event.preventDefault();
      onDeleteSelection([...selected]);
      return;
    }
    const steps = ARROW_STEPS[event.key];
    if (steps) {
      const ids =
        selectable() && selected.size && (!entry || selected.has(entry.token.id))
          ? [...selected]
          : entry
            ? [entry.token.id]
            : [];
      if (ids.length === 0) return;
      event.preventDefault();
      stepTokens(ids, steps);
      return;
    }
    // Nur Enter: Die Leertaste gehört dem Verschieben (Leertaste + Maus).
    if (entry && event.key === 'Enter') {
      event.preventDefault();
      if (!selectable()) return;
      setSelection([entry.token.id]);
      onActivate(entry.token);
    }
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('contextmenu', (event) => event.preventDefault()); // rechte Taste verschiebt
  element.addEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', (event) => {
    const dialogOpen = Boolean(document.querySelector('dialog[open]')); // Esc schließt dann nur den Dialog
    if (event.key === 'Escape' && element.classList.contains('is-fullscreen') && !dialogOpen) toggleFullscreen();
    if (event.key === ' ' && !isTyping(event.target) && element.contains(document.activeElement)) {
      if (!spaceDown) viewport.classList.add('is-panning');
      spaceDown = true;
      event.preventDefault();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.key === ' ') {
      spaceDown = false;
      viewport.classList.remove('is-panning');
    }
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
      selectButton.hidden = !selectable();
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
      setSelection([...selected]); // verschwundene Figuren fallen aus der Auswahl
      if (!userMoved && !hadMine && tokens.some(isMine)) showStart(); // eigene Figur ist dazugekommen
    },
    /** Figuren, die gerade am Zug sind, hervorheben. */
    setHighlight(ids) {
      highlighted = new Set(ids);
      for (const entry of tokenViews.values()) {
        entry.element.classList.toggle('is-turn', highlighted.has(entry.token.id));
      }
    },
    /** Auswahl von außen setzen (z. B. „Auswahl aufheben“ im Panel). */
    setSelection,
    selection: () => [...selected],
    /** Mitte des sichtbaren Ausschnitts in Kartenpunkten (zum Aufstellen neuer Figuren). */
    visibleCenter() {
      if (!map || !hasSize()) return { x: (map?.width ?? 0) / 2, y: (map?.height ?? 0) / 2 };
      return clampToMap(screenToMap(view, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }), map);
    },
    fit,
  };
}
