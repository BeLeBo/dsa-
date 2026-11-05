/**
 * map-stage.js – Die Karte zum Anfassen: verschieben, zoomen (zwei Finger, Mausrad, Knöpfe),
 * Figuren ziehen und – für den Meister – Figuren auswählen wie am Desktop:
 *  - Antippen wählt eine Figur, Strg/Umschalt + Antippen fügt hinzu oder nimmt heraus.
 *  - Rahmen aufziehen (Maus: linke Taste auf freier Fläche, Handy: Knopf „Auswählen“).
 *  - Ausgewählte Figuren ziehen: alle wandern mit, die Formation bleibt.
 *  - Karte verschieben: Finger, rechte/mittlere Maustaste oder Leertaste + Maus.
 *  - Stelle markieren (Ping): lange drücken, Alt + Klick oder Knopf „Stelle markieren“ und tippen.
 *    Ein Ping leuchtet ein paar Sekunden; liegt er außerhalb des Ausschnitts, rückt die Karte nach.
 *  - Zeichnen (Knopf „Stift“): Ein Finger bzw. die linke Maustaste malt, zieht Formen auf
 *    (Linie, Pfeil, Rechteck, Kreis – mit Umschalttaste gerade bzw. gleichmäßig), füllt mit dem
 *    Farbeimer (antippen) oder radiert; zwei Finger bzw. rechte Maustaste/Leertaste verschieben
 *    weiter die Karte. Die Zeichnungen liegen auf der Karte.
 *
 * Kartenbild und Raster werden mit der Karte skaliert; die Figuren liegen in einer eigenen
 * Ebene in Bildschirmgröße darüber – so bleiben Namen, Kürzel und Bilder bei jedem Zoom scharf.
 * Zoomt man weiter hinein, als das Kartenbild Auflösung hat, zeichnet die Schärfe-Ebene den
 * sichtbaren Ausschnitt nach dem Zoomen neu: aus den Detailkacheln großer Karten oder
 * hochgerechnet und nachgeschärft (siehe map-detail.js).
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
  viewToReveal,
  PING_DURATION_MS,
  TOKEN_COLORS,
  addStrokePoint,
  strokePath,
  drawingsAt,
  drawingWidth,
  drawColorValue,
  drawingPaths,
  fillParts,
  fillColor,
  constrainShape,
  SHAPE_KINDS,
  MAX_DRAWING_POINTS,
} from '../map.js';
import { bucketOutline } from '../flood-fill.js';
import {
  planSharpLayer,
  normalizeDetail,
  tilesInRegion,
  tilePath,
  sharpenAmount,
  visibleRegion,
  MAX_SHARPEN_PIXELS,
} from '../map-detail.js';
import { unsharpMask } from '../sharpen.js';

/** Ab dieser Bewegung (Bildschirmpunkte) ist es kein Antippen mehr. */
const DRAG_THRESHOLD_PX = 6;
const WHEEL_ZOOM_SPEED = 0.0015;
const BUTTON_ZOOM_FACTOR = 1.4;
/** Kleiner dargestellte Felder (Bildschirmpunkte): Namen nur noch bei wichtigen Figuren. */
const COMPACT_CELL_PX = 26;
/** Kleiner dargestellte Felder: keine Rasterlinien (sonst nur noch ein grauer Schleier). */
const MIN_GRID_LINE_CELL_PX = 8;
/** Figuren werden nie kleiner gezeichnet – auch auf Stadtkarten mit winzigen Feldern noch zu sehen. */
const MIN_TOKEN_SCREEN_PX = 12;
/** Zu Beginn wird so weit vergrößert, dass die eigene Figur gut zu sehen ist. */
const READABLE_CELL_PX = 36;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** So lange gedrückt halten (ohne zu ziehen) setzt einen Ping. */
const LONG_PRESS_MS = 550;
/** Ein Ping so nah am Rand (Bildschirmpunkte) holt die Karte ins Bild. */
const PING_MARGIN_PX = 48;
const PAN_ANIMATION_MS = 350;
/** Zeichnen: Abstand zwischen zwei Punkten einer Linie (Bildschirmpunkte) und Reichweite des Radierers. */
const MIN_STROKE_STEP_PX = 2;
const ERASER_RADIUS_PX = 14;
/** Kleinere Formen (Bildschirmpunkte) gelten als versehentlich angetippt. */
const MIN_SHAPE_PX = 6;
/** Farbeimer: so viele Bildpunkte untersucht er höchstens (sichtbarer Bereich in Bildschirmauflösung). */
const BUCKET_MAX_PIXELS = 4_000_000;
/** Schärfe-Ebene: so lange nach dem letzten Verschieben/Zoomen warten, dann neu zeichnen. */
const SHARP_SETTLE_MS = 160;
/** So viele Detailkacheln bleiben entpackt im Speicher (je bis zu 4 MB). */
const MAX_TILE_BITMAPS = 24;
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
 * @param {(token: object) => object|null} options.lifeOf  Lebensbalken (siehe tokenLifeBar in map.js)
 * @param {() => boolean} options.selectable            Auswahl erlaubt (Meister)?
 * @param {(moves: {id, x, y}[]) => void} options.onMove  Figuren abgelegt (eingerastet)
 * @param {(ids: string[]) => void} options.onSelect      Auswahl hat sich geändert
 * @param {(token: object) => void} options.onTap         Figur angetippt, ohne Auswahl (Spieler)
 * @param {(token: object) => void} options.onActivate    Enter auf einer Figur (Tastatur)
 * @param {(ids: string[]) => void} options.onDeleteSelection  Entf-Taste bei Auswahl
 * @param {() => boolean} options.canPing                Stellen markieren erlaubt (Meister, gezeigte Karte)?
 * @param {(point: {x, y}) => void} options.onPing        Stelle markiert (Kartenpunkte)
 * @param {() => boolean} options.canDraw                Zeichnen erlaubt?
 * @param {(drawing: object) => boolean} options.canErase  Darf der Radierer diese Linie löschen?
 * @param {(drawing: object) => void} options.onStroke  Zeichnung fertig: { kind, points | rings, color, width, fill } in Kartenpunkten
 * @param {() => void} [options.onBucketMiss]          Farbeimer fand keine Fläche (z. B. auf einem Strich)
 * @param {(ids: string[]) => void} options.onErase       Linien wegradiert
 * @param {() => void} options.onUndo                     Strg + Z beim Zeichnen
 * @param {(active: boolean) => void} options.onDrawModeChange  Stift an oder aus
 * @param {(path: string) => Promise<string>} options.loadImage  Bildadresse zu einem Speicherpfad
 * @param {(path: string) => Promise<Blob>} [options.loadTile]  Detailkachel großer Karten laden
 */
export function createMapStage({
  canMove,
  isMine,
  lifeOf = () => null,
  selectable = () => false,
  onMove,
  onSelect = () => {},
  onTap = () => {},
  onActivate = () => {},
  onDeleteSelection = () => {},
  canPing = () => false,
  onPing = () => {},
  canDraw = () => false,
  canErase = () => true,
  onStroke = () => {},
  onBucketMiss = () => {},
  onErase = () => {},
  onUndo = () => {},
  onDrawModeChange = () => {},
  loadImage,
  loadTile = null,
}) {
  const image = h('img', { class: 'map-image', alt: '', draggable: 'false' });
  const sharpCanvas = h('canvas', { class: 'map-sharp', 'aria-hidden': 'true', hidden: true });
  const grid = createGridLayer();
  const drawLayer = svg('svg', { class: 'map-drawings', 'aria-hidden': 'true' });
  // Flächen (Farbeimer) unter den Linien – Wände und Pfeile bleiben darauf sichtbar.
  const drawFills = svg('g');
  const drawLines = svg('g');
  drawLayer.append(drawFills, drawLines);
  const stage = h('div', { class: 'map-stage' }, image, sharpCanvas, grid.element, drawLayer);
  const tokenLayer = h('div', { class: 'map-tokens' });
  const pingLayer = h('div', { class: 'map-pings', 'aria-hidden': 'true' });
  const marquee = h('div', { class: 'map-marquee', hidden: true });
  const status = h('div', { class: 'map-status', role: 'status' });
  const pingHint = h('div', { class: 'map-hint', hidden: true }, 'Tippe auf die Stelle, die alle sehen sollen.');
  const announcer = h('div', { class: 'visually-hidden', role: 'status' });
  const viewport = h(
    'div',
    { class: 'map-viewport', tabindex: '-1' },
    stage,
    tokenLayer,
    pingLayer,
    marquee,
    status,
    pingHint,
    announcer,
  );

  const controlButton = (label, path, onclick, extra = {}) =>
    h('button', { type: 'button', class: 'map-control', 'aria-label': label, onclick, ...extra }, icon(path));
  const selectButton = controlButton('Auswählen (Rahmen ziehen)', ICONS.select, toggleSelectMode, {
    'aria-pressed': 'false',
    hidden: true,
  });
  const pingButton = controlButton('Stelle markieren (Ping)', ICONS.ping, () => setPingMode(!pingMode), {
    'aria-pressed': 'false',
    hidden: true,
  });
  const drawButton = controlButton('Zeichnen (Stift)', ICONS.pen, () => setDrawMode(!drawMode), {
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
    pingButton,
    drawButton,
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
  let pingMode = false;
  let drawMode = false;
  /**
   * Stift: Werkzeug ('pen', eine Form aus SHAPE_KINDS, 'bucket' oder 'eraser'), Farbe (Name oder
   * Hex), Stärke und Füllung (siehe DRAW_COLORS, DRAW_WIDTHS, DRAW_FILLS).
   */
  let drawStyle = { tool: 'pen', color: 'rot', width: 'mittel', fill: 'keine' };
  let drawings = [];
  const drawingViews = new Map();
  /** Linie, die gerade gezeichnet wird: { path, points, color, width }; Form: { kind, start, end, … }. */
  let draft = null;
  let shapeDraft = null;
  /** Detailstufen der Karte (normalizeDetail) und was die Schärfe-Ebene gerade zeigt. */
  let detail = null;
  let sharpTimer = 0;
  let sharpToken = 0;
  let sharpShown = null;
  let workCanvas = null;
  /** Entpackte Detailkacheln (älteste zuerst) und gerade ladende. */
  const tileBitmaps = new Map();
  const tileLoads = new Map();
  let pressTimer = null;
  /** Leuchtende Pings { element, point } und ein Ping, der auf eine sichtbare Karte wartet. */
  const pings = new Set();
  let waitingPing = null;
  let panAnimation = 0;
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
    const cellPx = gridValues ? gridValues.size * view.scale : Infinity;
    tokenLayer.classList.toggle('is-compact', cellPx < COMPACT_CELL_PX);
    grid.element.classList.toggle('is-dense', cellPx < MIN_GRID_LINE_CELL_PX);
    for (const entry of tokenViews.values()) placeToken(entry);
    for (const entry of pings) placePing(entry);
    scheduleSharp();
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
      const scale = Math.min(zoomLimits(size, map, gridValues).max, readable);
      view = { scale, x: size.width / 2 - center.x * scale, y: size.height / 2 - center.y * scale };
    }
    applyView();
  }

  function zoomBy(factor, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    if (!map || !hasSize()) return;
    userMoved = true;
    view = zoomAt(view, factor, point, zoomLimits(viewportSize(), map, gridValues));
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
    if (waitingPing) {
      // Die Karte war verdeckt (anderer Tab), als der Ping kam – jetzt zeigen, falls noch aktuell.
      const { point, until } = waitingPing;
      waitingPing = null;
      if (Date.now() < until) showPing(point, { reveal: true, duration: until - Date.now() });
    }
  }

  function toggleFullscreen() {
    const active = element.classList.toggle('is-fullscreen');
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', active ? 'Vollbild beenden' : 'Vollbild');
    document.body.classList.toggle('map-fullscreen-open', active);
  }

  /** Knopf „Stelle markieren“: Der nächste Tipp auf die Karte setzt einen Ping. */
  function setPingMode(active) {
    if (active) setDrawMode(false);
    pingMode = active;
    pingButton.setAttribute('aria-pressed', String(active));
    viewport.classList.toggle('is-ping-mode', active);
    pingHint.hidden = !active;
  }

  // -------------------------------------------------------------------------
  // Ping
  // -------------------------------------------------------------------------

  function placePing(entry) {
    const center = mapToScreen(view, entry.point);
    entry.element.style.transform = `translate(${center.x}px, ${center.y}px)`;
  }

  /** Schiebt die Karte sanft so, dass der Punkt in der Mitte steht (nur wenn er am Rand oder draußen liegt). */
  function reveal(point) {
    const size = viewportSize();
    const target = viewToReveal(view, point, size, Math.min(PING_MARGIN_PX, size.width / 4, size.height / 4));
    if (!target) return;
    const from = view;
    const to = clampView(target, size, map);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(panAnimation);
    if (reduced) {
      view = to;
      applyView();
      return;
    }
    const start = performance.now();
    const step = (now) => {
      if (gesture) return; // Wer selbst schiebt oder zoomt, hat Vorrang.
      const t = Math.min(1, (now - start) / PAN_ANIMATION_MS);
      const eased = 1 - (1 - t) ** 3;
      view = { scale: from.scale, x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
      applyView();
      if (t < 1) panAnimation = requestAnimationFrame(step);
    };
    panAnimation = requestAnimationFrame(step);
  }

  /**
   * Ping zeigen: pulsierende Ringe an der Stelle (Kartenpunkte), ein paar Sekunden lang.
   * Ist die Karte gerade nicht zu sehen (anderer Tab), wird er beim Erscheinen nachgeholt.
   */
  function showPing(point, { reveal: shouldReveal = true, duration = PING_DURATION_MS } = {}) {
    if (!map) return;
    if (!hasSize()) {
      waitingPing = { point, until: Date.now() + duration };
      return;
    }
    if (shouldReveal) reveal(point);
    const marker = h(
      'div',
      { class: 'map-ping' },
      h('span', { class: 'map-ping-ring' }),
      h('span', { class: 'map-ping-ring' }),
      h('span', { class: 'map-ping-dot' }),
    );
    marker.style.setProperty('--ping-duration', `${duration}ms`);
    const entry = { element: marker, point };
    pings.add(entry);
    pingLayer.append(marker);
    placePing(entry);
    announcer.textContent = '';
    announcer.textContent = 'Eine Stelle auf der Karte ist markiert.';
    setTimeout(() => {
      marker.remove();
      pings.delete(entry);
    }, duration);
  }

  function ping(point) {
    if (!map || !canPing()) return;
    setPingMode(false);
    onPing(clampToMap(screenToMap(view, point), map));
  }

  function cancelLongPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  /** Lange drücken (ohne zu ziehen) setzt einen Ping – auch am Handy, ohne den Knopf. */
  function startLongPress(point) {
    cancelLongPress();
    if (!canPing() || drawMode) return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      if (!gesture || gesture.moved || pointers.size !== 1) return;
      if (gesture.kind === 'token' && gesture.group.length) return;
      gesture.pinged = true;
      marquee.hidden = true;
      ping(point);
    }, LONG_PRESS_MS);
  }

  /** Handy/Tablet: Ein Finger zieht dann einen Auswahlrahmen statt die Karte zu verschieben. */
  function toggleSelectMode() {
    selectMode = !selectMode;
    if (selectMode) setDrawMode(false);
    selectButton.setAttribute('aria-pressed', String(selectMode));
    viewport.classList.toggle('is-select-mode', selectMode);
  }

  new ResizeObserver(onResize).observe(viewport);

  // -------------------------------------------------------------------------
  // Schärfe-Ebene: beim Hineinzoomen den sichtbaren Ausschnitt in Bildschirmauflösung
  // (Detailkacheln oder hochgerechnet und nachgeschärft). Während Gesten wird sie mit der
  // Karte mitskaliert, kurz danach neu gezeichnet.
  // -------------------------------------------------------------------------

  /** Bildpunkte des Vorschaubilds je Kartenpunkt (0, solange es nicht geladen ist). */
  const baseScale = () => (map && image.naturalWidth > 0 && image.complete ? image.naturalWidth / map.width : 0);

  function scheduleSharp(delay = SHARP_SETTLE_MS) {
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(() => renderSharp().catch(() => hideSharp()), delay);
  }

  function hideSharp() {
    sharpToken += 1;
    sharpShown = null;
    sharpCanvas.hidden = true;
  }

  const contains = (outer, inner) =>
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5;

  function releaseTiles() {
    for (const bitmap of tileBitmaps.values()) bitmap.close?.();
    tileBitmaps.clear();
  }

  /** Kachel laden und entpacken; die ältesten fallen heraus – nie die gerade gebrauchten. */
  function loadTileBitmap(path, keep) {
    if (tileBitmaps.has(path) || !loadTile) return Promise.resolve();
    if (!tileLoads.has(path)) {
      const forDetail = detail;
      const loading = loadTile(path)
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          if (detail !== forDetail) return bitmap.close?.(); // inzwischen andere Karte
          tileBitmaps.set(path, bitmap);
          trimTiles(keep);
        })
        .finally(() => tileLoads.delete(path));
      tileLoads.set(path, loading);
    }
    return tileLoads.get(path);
  }

  function trimTiles(keep) {
    for (const [path, bitmap] of tileBitmaps) {
      if (tileBitmaps.size <= Math.max(MAX_TILE_BITMAPS, keep.size)) break;
      if (keep.has(path)) continue;
      bitmap.close?.();
      tileBitmaps.delete(path);
    }
  }

  /** Zuletzt benutzte Kacheln ans Ende (sie fallen zuletzt heraus). */
  function useTile(path) {
    const bitmap = tileBitmaps.get(path);
    if (!bitmap) return null;
    tileBitmaps.delete(path);
    tileBitmaps.set(path, bitmap);
    return bitmap;
  }

  /** Zeichnet den Plan mit dem, was schon da ist: Vorschaubild als Grund, Kacheln darüber. */
  function drawSharp(plan, tiles) {
    const { region } = plan;
    const scaleOfBase = baseScale();
    const fromBase = (target, width, height) => {
      const sx = Math.max(0, region.x * scaleOfBase);
      const sy = Math.max(0, region.y * scaleOfBase);
      const sw = Math.min(image.naturalWidth - sx, region.width * scaleOfBase);
      const sh = Math.min(image.naturalHeight - sy, region.height * scaleOfBase);
      if (sw > 0 && sh > 0) target.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
    };
    if (sharpCanvas.width !== plan.width) sharpCanvas.width = plan.width;
    if (sharpCanvas.height !== plan.height) sharpCanvas.height = plan.height;
    const context = sharpCanvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (plan.sharpen) {
      // Ausschnitt in Bildpunkten der Quelle zusammensetzen, schärfen, dann hochrechnen.
      const { crop } = plan;
      workCanvas ??= document.createElement('canvas');
      workCanvas.width = crop.width;
      workCanvas.height = crop.height;
      const work = workCanvas.getContext('2d', { willReadFrequently: true });
      work.imageSmoothingEnabled = true;
      work.imageSmoothingQuality = 'high';
      fromBase(work, crop.width, crop.height);
      for (const tile of tiles) {
        const bitmap = useTile(tile.path);
        if (bitmap) work.drawImage(bitmap, tile.pixels.x - crop.x, tile.pixels.y - crop.y);
      }
      if (crop.width * crop.height <= MAX_SHARPEN_PIXELS) {
        const pixels = work.getImageData(0, 0, crop.width, crop.height);
        unsharpMask(pixels.data, crop.width, crop.height, sharpenAmount(plan.source.magnification));
        work.putImageData(pixels, 0, 0);
      }
      context.drawImage(workCanvas, 0, 0, crop.width, crop.height, 0, 0, plan.width, plan.height);
    } else {
      // Die Detailstufe reicht: Kacheln direkt in Bildschirmauflösung zeichnen.
      fromBase(context, plan.width, plan.height);
      const factor = plan.width / region.width;
      for (const tile of tiles) {
        const bitmap = useTile(tile.path);
        if (!bitmap) continue;
        const left = Math.round((tile.map.x - region.x) * factor);
        const top = Math.round((tile.map.y - region.y) * factor);
        const right = Math.round((tile.map.x + tile.map.width - region.x) * factor);
        const bottom = Math.round((tile.map.y + tile.map.height - region.y) * factor);
        context.drawImage(bitmap, 0, 0, tile.pixels.width, tile.pixels.height, left, top, right - left, bottom - top);
      }
    }
    Object.assign(sharpCanvas.style, {
      left: `${region.x}px`,
      top: `${region.y}px`,
      width: `${region.width}px`,
      height: `${region.height}px`,
    });
    sharpCanvas.hidden = false;
  }

  async function renderSharp() {
    if (!map || !hasSize() || !baseScale()) {
      hideSharp();
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const size = viewportSize();
    const plan = planSharpLayer({
      view,
      viewport: size,
      map,
      dpr,
      baseScale: baseScale(),
      levels: detail?.levels ?? [],
    });
    if (!plan) {
      hideSharp();
      return;
    }
    // Gleicher Zoom und der sichtbare Teil liegt noch im gezeichneten Bereich: nichts zu tun.
    const key = [map.id, map.image_path, detail?.path, plan.source.level, (view.scale * dpr).toFixed(5)].join('|');
    const visible = visibleRegion(view, size, map, 0);
    if (sharpShown?.key === key && sharpShown.complete && visible && contains(sharpShown.region, visible)) return;
    sharpToken += 1;
    const token = sharpToken;
    const level = plan.source.level === null ? null : detail.levels[plan.source.level];
    const tiles = level
      ? tilesInRegion(level, detail.tile, plan.region).map((tile) => ({
          ...tile,
          path: tilePath(detail, plan.source.level, tile.col, tile.row),
        }))
      : [];
    const keep = new Set(tiles.map((tile) => tile.path));
    const missing = tiles.filter((tile) => !tileBitmaps.has(tile.path));
    drawSharp(plan, tiles);
    sharpShown = { key, region: plan.region, complete: missing.length === 0 };
    if (missing.length === 0) return;
    // Fehlende Kacheln laden; sobald welche da sind, neu zeichnen.
    let redraw = 0;
    await Promise.allSettled(
      missing.map((tile) =>
        loadTileBitmap(tile.path, keep).then(() => {
          if (token !== sharpToken) return;
          cancelAnimationFrame(redraw);
          redraw = requestAnimationFrame(() => token === sharpToken && drawSharp(plan, tiles));
        }),
      ),
    );
    if (token !== sharpToken) return;
    cancelAnimationFrame(redraw);
    drawSharp(plan, tiles);
    sharpShown = { key, region: plan.region, complete: true };
  }

  // -------------------------------------------------------------------------
  // Zeichnen (Ebene auf der Karte, wird mit ihr skaliert)
  // -------------------------------------------------------------------------

  /** Stift an oder aus. Beim Zeichnen gibt es keine Auswahl, keinen Ping und keinen Rahmen. */
  function setDrawMode(active) {
    const next = Boolean(active) && Boolean(map) && canDraw();
    if (next === drawMode) return;
    drawMode = next;
    discardDraft();
    discardShape();
    if (['draw', 'erase', 'shape', 'bucket'].includes(gesture?.kind)) gesture = null;
    if (drawMode) {
      setPingMode(false);
      if (selectMode) toggleSelectMode();
      setSelection([]);
    }
    showErasing(new Set());
    drawButton.setAttribute('aria-pressed', String(drawMode));
    viewport.classList.toggle('is-draw-mode', drawMode);
    viewport.dataset.tool = drawStyle.tool;
    onDrawModeChange(drawMode);
  }

  /** SVG-Gruppe einer Zeichnung: Fläche, Linie und Pfeilspitze (siehe drawingPaths). */
  function drawingElement(drawing) {
    const group = svg('g');
    const paths = drawingPaths(drawing);
    const stroke = drawColorValue(drawing.color);
    if (paths.fill && drawing.fill) {
      const { color, opacity } = fillParts(drawing.fill);
      group.append(svg('path', { d: paths.fill, fill: color, 'fill-opacity': opacity, 'fill-rule': 'evenodd' }));
    }
    if (paths.stroke) {
      group.append(svg('path', { d: paths.stroke, fill: 'none', stroke, 'stroke-width': drawing.width }));
    }
    if (paths.head) {
      group.append(svg('path', { d: paths.head, fill: stroke, stroke, 'stroke-width': drawing.width * 0.6 }));
    }
    return group;
  }

  function renderDrawings() {
    const ids = new Set(drawings.map((drawing) => drawing.id));
    for (const [id, element] of drawingViews) {
      if (ids.has(id)) continue;
      element.remove();
      drawingViews.delete(id);
    }
    for (const drawing of drawings) {
      if (drawingViews.has(drawing.id)) continue;
      const element = drawingElement(drawing);
      drawingViews.set(drawing.id, element);
      (drawing.kind === 'fill' ? drawFills : drawLines).append(element);
    }
  }

  /** Zeichnungen, die der Radierer gerade berührt, blass zeigen. */
  function showErasing(ids) {
    for (const [id, element] of drawingViews) element.classList.toggle('is-erasing', ids.has(id));
  }

  function beginDraft(point) {
    const color = drawStyle.color;
    const width = drawingWidth(drawStyle.width, gridValues);
    const path = svg('path', { class: 'is-draft', fill: 'none', stroke: drawColorValue(color), 'stroke-width': width });
    drawLayer.append(path);
    draft = { path, points: [point], color, width };
    path.setAttribute('d', strokePath(draft.points));
  }

  function extendDraft(screenPoint) {
    if (!draft) return;
    const point = clampToMap(screenToMap(view, screenPoint), map);
    if (!addStrokePoint(draft.points, point, MIN_STROKE_STEP_PX / view.scale)) return;
    if (draft.points.length >= MAX_DRAWING_POINTS) {
      // Sehr lange Linie: dieses Stück speichern und nahtlos weiterzeichnen.
      commitDraft();
      beginDraft(point);
      return;
    }
    draft.path.setAttribute('d', strokePath(draft.points));
  }

  function commitDraft() {
    const finished = draft;
    draft = null;
    if (!finished) return;
    onStroke({ points: finished.points, color: finished.color, width: finished.width });
    finished.path.remove(); // erst danach: Die gespeicherte Linie steht dann schon da
  }

  function discardDraft() {
    draft?.path.remove();
    draft = null;
  }

  /** Form (Linie, Pfeil, Rechteck, Kreis) aufziehen: Vorschau zwischen Anfang und Finger. */
  function beginShape(point) {
    const kind = drawStyle.tool;
    const filled = kind === 'rect' || kind === 'ellipse';
    shapeDraft = {
      kind,
      start: point,
      end: point,
      color: drawStyle.color,
      width: drawingWidth(drawStyle.width, gridValues),
      fill: filled ? fillColor(drawStyle.color, drawStyle.fill) : null,
      element: null,
    };
    renderShapeDraft();
  }

  function renderShapeDraft() {
    const { kind, start, end, color, width, fill } = shapeDraft;
    const element = drawingElement({ kind, color, width, fill, points: [start, end] });
    element.classList.add('is-draft');
    if (shapeDraft.element) shapeDraft.element.replaceWith(element);
    else drawLayer.append(element);
    shapeDraft.element = element;
  }

  function updateShape(screenPoint, constrain) {
    if (!shapeDraft) return;
    let end = clampToMap(screenToMap(view, screenPoint), map);
    if (constrain) end = clampToMap(constrainShape(shapeDraft.kind, shapeDraft.start, end), map);
    shapeDraft.end = end;
    renderShapeDraft();
  }

  function commitShape() {
    const finished = shapeDraft;
    shapeDraft = null;
    if (!finished) return;
    const { kind, start, end, color, width, fill } = finished;
    if (Math.hypot(end.x - start.x, end.y - start.y) * view.scale >= MIN_SHAPE_PX) {
      onStroke({ kind, points: [start, end], color, width, fill });
    }
    finished.element?.remove();
  }

  function discardShape() {
    shapeDraft?.element?.remove();
    shapeDraft = null;
  }

  /** Zeichnung auf eine Leinwand (für den Farbeimer: Linien und Flächen sind Grenzen). */
  function paintDrawing(context, drawing) {
    const paths = drawingPaths(drawing);
    const stroke = drawColorValue(drawing.color);
    if (paths.fill && drawing.fill) {
      const { color, opacity } = fillParts(drawing.fill);
      context.globalAlpha = opacity;
      context.fillStyle = color;
      context.fill(new Path2D(paths.fill), 'evenodd');
      context.globalAlpha = 1;
    }
    if (paths.stroke) {
      context.lineWidth = drawing.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = stroke;
      context.stroke(new Path2D(paths.stroke));
    }
    if (paths.head) {
      context.fillStyle = stroke;
      context.fill(new Path2D(paths.head));
    }
  }

  /**
   * Farbeimer: die Fläche um den Punkt (Kartenpunkte) so, wie man sie sieht – Kartenbild,
   * Detailkacheln und alle Zeichnungen. Gesucht wird im sichtbaren Bereich (mit Rand) in
   * Bildschirmauflösung. Liefert die Umrisse in Kartenpunkten oder null.
   */
  function bucketRings(point) {
    const region = visibleRegion(view, viewportSize(), map, 0.5);
    if (!region || !baseScale()) return null;
    let factor = view.scale;
    const pixels = region.width * region.height * factor * factor;
    if (pixels > BUCKET_MAX_PIXELS) factor *= Math.sqrt(BUCKET_MAX_PIXELS / pixels);
    const width = Math.max(1, Math.round(region.width * factor));
    const height = Math.max(1, Math.round(region.height * factor));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.setTransform(factor, 0, 0, factor, -region.x * factor, -region.y * factor);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, map.width, map.height);
    if (!sharpCanvas.hidden && sharpShown) {
      const shown = sharpShown.region;
      context.drawImage(sharpCanvas, shown.x, shown.y, shown.width, shown.height);
    }
    for (const drawing of drawings) paintDrawing(context, drawing);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    const rings = bucketOutline(data, width, height, (point.x - region.x) * factor, (point.y - region.y) * factor, {
      maxPoints: MAX_DRAWING_POINTS,
    });
    return rings?.map((ring) => ring.map((spot) => ({ x: region.x + spot.x / factor, y: region.y + spot.y / factor })));
  }

  function bucketAt(screenPoint) {
    const point = screenToMap(view, screenPoint);
    if (!map || point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height) return;
    const rings = bucketRings(point);
    if (!rings) {
      onBucketMiss();
      return;
    }
    const fill = fillColor(drawStyle.color, drawStyle.fill === 'voll' ? 'voll' : 'halb');
    onStroke({ kind: 'fill', rings, color: drawStyle.color, width: 1, fill });
  }

  function eraseAt(screenPoint) {
    const point = screenToMap(view, screenPoint);
    const before = gesture.hits.size;
    const erasable = drawings.filter(canErase);
    for (const id of drawingsAt(erasable, point, ERASER_RADIUS_PX / view.scale)) gesture.hits.add(id);
    if (gesture.hits.size !== before) showErasing(gesture.hits);
  }

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
    const diameter = Math.max(MIN_TOKEN_SCREEN_PX, tokenDiameter(entry.token.size, gridValues) * view.scale);
    const center = mapToScreen(view, entry.position);
    entry.element.style.width = `${diameter}px`;
    entry.element.style.height = `${diameter}px`;
    entry.element.style.setProperty('--token-size', `${diameter}px`);
    entry.element.style.transform = `translate(${center.x - diameter / 2}px, ${center.y - diameter / 2}px)`;
  }

  /** Lebensbalken unter der Figur: ein durchgehender Balken oder mehrere Abschnitte. */
  function renderLife(entry, life) {
    entry.element.classList.toggle('has-life', Boolean(life));
    entry.element.classList.toggle('is-down', life?.level === 'am-boden');
    entry.life.hidden = !life;
    const key = life ? JSON.stringify(life) : '';
    if (!life || key === entry.lifeKey) return;
    entry.lifeKey = key;
    entry.life.dataset.level = life.level;
    entry.life.setAttribute('aria-label', life.label);
    if (entry.life.children.length !== life.cells.length) {
      entry.life.replaceChildren(
        ...life.cells.map(() =>
          h('span', { class: 'map-token-life-cell' }, h('span', { class: 'map-token-life-fill' })),
        ),
      );
    }
    life.cells.forEach((fill, index) => {
      entry.life.children[index].firstChild.style.width = `${Math.round(fill * 100)}%`;
    });
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
    renderLife(entry, lifeOf(token));
    renderFace(entry, token);
    placeToken(entry);
  }

  function createTokenView(token) {
    const face = h('span', { class: 'map-token-face' });
    const life = h('span', { class: 'map-token-life', role: 'img', hidden: true });
    const name = h('span', { class: 'map-token-name' });
    const tokenElement = h(
      'div',
      { class: 'map-token', role: 'button', tabindex: '0', dataset: { tokenId: token.id } },
      face,
      life,
      name,
    );
    return { element: tokenElement, face, life, lifeKey: '', name, token, position: { x: token.x, y: token.y } };
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
    if (pingMode && !panButton) {
      gesture = { kind: 'pan', start: point, last: point, moved: false, ping: true };
      return;
    }
    if (drawMode && !panButton && (!isMouse || event.button === 0)) {
      if (drawStyle.tool === 'eraser') {
        gesture = { kind: 'erase', start: point, moved: false, hits: new Set() };
        eraseAt(point);
      } else if (drawStyle.tool === 'bucket') {
        // Antippen füllt; wer zieht, verschiebt die Karte.
        gesture = { kind: 'bucket', start: point, last: point, moved: false };
      } else if (SHAPE_KINDS.includes(drawStyle.tool)) {
        gesture = { kind: 'shape', start: point, moved: false };
        beginShape(clampToMap(screenToMap(view, point), map));
      } else {
        gesture = { kind: 'draw', start: point, moved: false };
        beginDraft(clampToMap(screenToMap(view, point), map));
      }
      return;
    }
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
    cancelAnimationFrame(panAnimation);
    if (pointers.size === 1 && event.altKey && event.button === 0 && canPing()) {
      // Alt + Klick: sofort ein Ping, sonst nichts
      pointers.delete(event.pointerId);
      ping(point);
      return;
    }
    if (pointers.size === 1) {
      startGesture(event, point);
      if (!gesture.ping) startLongPress(point);
    } else if (pointers.size === 2) {
      cancelLongPress();
      if (gesture?.kind === 'token' && gesture.moved) cancelTokenDrag();
      // Zweiter Finger beim Zeichnen: Es wird verschoben/gezoomt, die angefangene Linie verworfen.
      if (gesture?.kind === 'draw') discardDraft();
      if (gesture?.kind === 'shape') discardShape();
      if (gesture?.kind === 'erase') showErasing(new Set());
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
        zoomLimits(viewportSize(), map, gridValues),
      );
      applyView();
      return;
    }
    if (gesture.kind === 'shape') {
      updateShape(point, event.shiftKey);
      return;
    }
    if (gesture.kind === 'bucket') {
      if (distance(point, gesture.start) < DRAG_THRESHOLD_PX) return;
      gesture = { kind: 'pan', start: gesture.start, last: gesture.start, moved: true };
    }
    if (gesture.kind === 'draw' || gesture.kind === 'erase') {
      // Zwischenpunkte, die der Browser zusammengefasst hat, machen die Linie glatter.
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [event]) {
        const at = localPoint(viewport, sample);
        if (gesture.kind === 'draw') extendDraft(at);
        else eraseAt(at);
      }
      return;
    }
    if (gesture.pinged) return;
    if (!gesture.moved && distance(point, gesture.start) < DRAG_THRESHOLD_PX) return;
    cancelLongPress();
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
    cancelLongPress();
    const cancelled = event.type === 'pointercancel';
    if (finished.kind === 'draw') {
      if (cancelled) discardDraft();
      else commitDraft();
      return;
    }
    if (finished.kind === 'shape') {
      if (cancelled) discardShape();
      else commitShape();
      return;
    }
    if (finished.kind === 'bucket') {
      if (!cancelled) bucketAt(finished.start);
      return;
    }
    if (finished.kind === 'erase') {
      if (!cancelled && finished.hits.size) onErase([...finished.hits]);
      showErasing(new Set());
      return;
    }
    if (finished.pinged) {
      if (finished.kind === 'token') endDragVisuals(finished.group);
      return; // Lang gedrückt: Ping ist gesetzt, kein Antippen
    }
    if (finished.ping) {
      if (!finished.moved && !cancelled) ping(finished.start);
      return;
    }
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
    if (event.key === 'Escape' && pingMode) {
      event.preventDefault();
      event.stopPropagation();
      setPingMode(false);
      return;
    }
    if (event.key === 'Escape' && drawMode) {
      event.preventDefault();
      event.stopPropagation(); // erst den Stift weglegen, beim nächsten Esc das Vollbild beenden
      setDrawMode(false);
      return;
    }
    if (drawMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      onUndo();
      return;
    }
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
  // Der Ausschnitt wird nur über die Ansicht verschoben. Scrollt der Browser ihn doch (Fokus,
  // scrollIntoView, ältere Browser ohne overflow: clip), passen Karte und Finger nicht mehr zusammen.
  viewport.addEventListener('scroll', () => {
    if (viewport.scrollTop || viewport.scrollLeft) viewport.scrollTo(0, 0);
  });
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
        return image.decode().then(() => {
          if (!stillCurrent()) return;
          showStatus('');
          scheduleSharp(0); // jetzt kann die Schärfe-Ebene zeichnen
        });
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
      drawLayer.setAttribute('width', map.width);
      drawLayer.setAttribute('height', map.height);
      drawLayer.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
      selectButton.hidden = !selectable();
      pingButton.hidden = !canPing();
      drawButton.hidden = !canDraw();
      if (pingMode && !canPing()) setPingMode(false);
      if (drawMode && !canDraw()) setDrawMode(false);
      const nextDetail = normalizeDetail(map.detail, map);
      if (changedImage || nextDetail?.path !== detail?.path) {
        hideSharp();
        releaseTiles();
      }
      detail = nextDetail;
      if (changedImage) {
        discardDraft();
        discardShape();
      }
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
    /** Anzeige aller Figuren auffrischen (z. B. neue LeP im Heldenbogen). */
    refresh() {
      for (const entry of tokenViews.values()) updateToken(entry, entry.token);
    },
    /** Figuren, die gerade am Zug sind, hervorheben. */
    setHighlight(ids) {
      highlighted = new Set(ids);
      for (const entry of tokenViews.values()) {
        entry.element.classList.toggle('is-turn', highlighted.has(entry.token.id));
      }
    },
    /** Ping an einer Stelle der Karte zeigen; reveal: Karte rückt nach, wenn er nicht im Bild ist. */
    showPing,
    /** Linien des Stifts auf der Karte (siehe normalizeDrawing in map.js). */
    setDrawings(next) {
      drawings = next;
      renderDrawings();
    },
    /** Stift an oder aus (z. B. „Fertig“ in der Stiftleiste). */
    setDrawMode,
    isDrawing: () => drawMode,
    /** Werkzeug, Farbe oder Stärke des Stifts ändern. */
    setDrawStyle(changes) {
      drawStyle = { ...drawStyle, ...changes };
      viewport.dataset.tool = drawStyle.tool;
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
