/**
 * map-editor-view.js – Karten-Editor des Meisters: eine Karte aus Gelände und fertigen Objekten
 * (Bäume, Hütten, Felsen …) zusammenstellen oder automatisch erstellen lassen und als Karte
 * speichern. Gebaute Karten lassen sich später weiterbearbeiten (Größe bleibt dann gleich,
 * damit die Figuren an ihrem Platz bleiben).
 *
 * Bedienung: Ein Finger verschiebt die Ansicht (oder ein Objekt bzw. malt Gelände – je nach
 * Werkzeug), zwei Finger verschieben immer die Ansicht. Am Rechner: Strg + Mausrad zoomt,
 * Entf löscht das gewählte Objekt, Strg + Z macht rückgängig.
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { segmentedControl } from './segmented.js';
import { showToast, showError } from './toast.js';
import {
  CELL_PX,
  GROUNDS,
  MAX_OBJECTS,
  OBJECT_GROUPS,
  OBJECTS,
  SCENE_SIZES,
  TERRAINS,
  THEMES,
  addObject,
  clampScale,
  createScene,
  generateScene,
  normalizeScene,
  objectAt,
  objectType,
  paintStroke,
  randomSeed,
  removeObject,
  sceneGrid,
  sceneSize,
  setGround,
  snapObject,
  updateObject,
} from '../map-editor.js';
import {
  drawGridLines,
  drawObjectIcon,
  drawSelection,
  drawTerrainSwatch,
  renderObjects,
  renderSceneCanvas,
  renderTerrain,
} from '../map-render.js';
import { canvasToMapImage, ImageError } from '../image.js';
import { MAX_MAP_NAME_LENGTH } from '../map.js';

/** Zoomstufen: Bildschirmpunkte je Feld. */
const ZOOM_STEPS = [8, 12, 16, 20, 24, 32, 40, 48, 64, 80];
/** Neue Karten: so fein wie möglich – passt das Bild nicht in den Speicher, etwas gröber. */
const NEW_MAP_CELL_SIZES = [CELL_PX, 48, 32];
const MAX_UNDO = 40;
/** Bis zu dieser Bewegung (Bildschirmpunkte) gilt eine Berührung als Antippen. */
const TAP_TOLERANCE_PX = 8;
const ROTATE_STEP = 45;
const SCALE_STEP = 0.1;
const ICON_PX = 44;

const MODES = [
  { id: 'karte', name: 'Karte' },
  { id: 'objekte', name: 'Objekte' },
  { id: 'gelaende', name: 'Gelände' },
  { id: 'auswahl', name: 'Auswählen' },
];
const BRUSHES = [
  { id: '0', name: '1 Feld' },
  { id: '1', name: 'Klein' },
  { id: '2', name: 'Mittel' },
  { id: '3', name: 'Groß' },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

function field(label, control, hint = '') {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
  );
}

function select(options, value, onChange, disabled = false) {
  const element = h(
    'select',
    { disabled, onchange: () => onChange(element.value) },
    options.map((option) => h('option', { value: option.id, selected: option.id === value }, option.name)),
  );
  return element;
}

/** Kleine Leinwand mit Bild (Objekt oder Gelände) für die Auswahlknöpfe. */
function iconCanvas(draw) {
  const ratio = pixelRatio();
  const canvas = h('canvas', { width: ICON_PX * ratio, height: ICON_PX * ratio, class: 'map-editor-icon' });
  canvas.style.width = `${ICON_PX}px`;
  canvas.style.height = `${ICON_PX}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, ICON_PX * ratio);
  return canvas;
}

/** Kartenbild zeichnen und umwandeln; bei Bedarf gröber, bis es in den Speicher passt. */
async function sceneImage(scene, cellSizes) {
  for (const cellPx of cellSizes) {
    const canvas = renderSceneCanvas(scene, cellPx);
    const blob = await canvasToMapImage(canvas);
    canvas.width = 0; // Speicher sofort freigeben (große Leinwände)
    canvas.height = 0;
    if (blob) return { blob, cellPx, ...sceneSize(scene, cellPx) };
  }
  throw new ImageError('Die Karte ist zu groß für den Speicher. Bitte eine kleinere Karte bauen.');
}

/**
 * Öffnet den Karten-Editor.
 * @param {object} options
 * @param {object} options.controller  Karten-Steuerung (room-map.js)
 * @param {object} [options.map]        gebaute Karte zum Weiterbearbeiten (sonst neue Karte)
 */
export async function openMapEditor({ controller, map = null }) {
  let scene;
  if (map) {
    try {
      const stored = await controller.actions.loadScene(map.id);
      if (!stored) throw new Error('Diese Karte wurde nicht im Editor gebaut.');
      scene = normalizeScene(stored);
    } catch (error) {
      showError(error, 'Editor nicht geöffnet');
      return;
    }
  }
  createEditor({ controller, map, scene });
}

function createEditor({ controller, map, scene: storedScene }) {
  const editing = Boolean(map);
  let theme = THEMES[0].id;
  let sizeId = SCENE_SIZES[1].id;
  const sizeOf = (id) => SCENE_SIZES.find((size) => size.id === id) ?? SCENE_SIZES[1];
  let scene =
    storedScene ?? generateScene({ theme, cols: sizeOf(sizeId).cols, rows: sizeOf(sizeId).rows, seed: randomSeed() });
  let mode = editing ? 'objekte' : 'karte';
  let placeType = OBJECTS[0].id;
  let terrainCode = TERRAINS[0].code;
  let brush = 1;
  let snap = true;
  let showGrid = true;
  let selectedId = null;
  let cell = 24;
  let fitted = false;
  let changed = false;
  let nameTouched = editing;
  const undo = [];

  const dialog = openDialog({
    title: editing ? 'Karte bearbeiten' : 'Karte bauen',
    className: 'dialog-full map-editor',
    beforeClose: async () =>
      !changed ||
      confirmDialog('Die Änderungen an dieser Karte sind noch nicht gespeichert. Verwerfen?', {
        title: 'Karte nicht gespeichert',
        confirmLabel: 'Verwerfen',
        danger: true,
      }),
    onClose: () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    },
  });

  // ---------------------------------------------------------------------------
  // Szene ändern, Rückgängig
  // ---------------------------------------------------------------------------

  function remember(previous) {
    undo.push(previous);
    if (undo.length > MAX_UNDO) undo.shift();
    changed = true;
    updateTools();
  }

  /** Neue Szene übernehmen; record: false, wenn eine laufende Geste sich den Stand selbst merkt. */
  function setScene(next, { record = true } = {}) {
    if (next === scene) return;
    if (record) remember(scene);
    const resized = next.cols !== scene.cols || next.rows !== scene.rows;
    scene = next;
    if (selectedId && !scene.objects.some((object) => object.id === selectedId)) selectedId = null;
    if (resized) {
      fitted = false;
      layout();
    }
    updateSelection();
    updateTools();
    requestDraw();
  }

  function undoLast() {
    const previous = undo.pop();
    if (!previous) return;
    const resized = previous.cols !== scene.cols || previous.rows !== scene.rows;
    scene = previous;
    if (selectedId && !scene.objects.some((object) => object.id === selectedId)) selectedId = null;
    if (resized) {
      fitted = false;
      layout();
    }
    if (mode === 'karte') renderPanel();
    updateSelection();
    updateTools();
    requestDraw();
  }

  const selected = () => scene.objects.find((object) => object.id === selectedId) ?? null;

  function selectObject(id) {
    if (selectedId === id) return;
    selectedId = id;
    updateSelection();
    requestDraw();
  }

  // ---------------------------------------------------------------------------
  // Zeichenfläche
  // ---------------------------------------------------------------------------

  const sizer = h('div', { class: 'map-editor-sizer' });
  const scroller = h(
    'div',
    { class: 'map-editor-scroller', role: 'application', 'aria-label': 'Karte im Editor', tabindex: '0' },
    sizer,
  );
  const canvas = h('canvas', { class: 'map-editor-canvas', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'map-editor-stage' }, scroller, canvas);
  let offset = { x: 0, y: 0 };
  let frame = 0;
  /** Gelände wird zwischengespeichert und nur bei Änderungen (teilweise) neu gezeichnet. */
  let terrainCache = null;

  function layout() {
    const width = scene.cols * cell;
    const height = scene.rows * cell;
    offset = {
      x: Math.max(0, (scroller.clientWidth - width) / 2),
      y: Math.max(0, (scroller.clientHeight - height) / 2),
    };
    sizer.style.width = `${width}px`;
    sizer.style.height = `${height}px`;
    sizer.style.marginLeft = `${offset.x}px`;
    sizer.style.marginTop = `${offset.y}px`;
    requestDraw();
  }

  function fitZoom() {
    const width = scroller.clientWidth;
    const height = scroller.clientHeight;
    if (!width || !height) return;
    cell = clamp(Math.floor(Math.min(width / scene.cols, height / scene.rows)), ZOOM_STEPS[0], ZOOM_STEPS.at(-1));
    fitted = true;
    layout();
  }

  /** Zoomen; der Punkt focus (in Bildschirmpunkten der Fläche) bleibt stehen. */
  function zoomTo(next, focus = { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 }) {
    const target = clamp(Math.round(next), ZOOM_STEPS[0], ZOOM_STEPS.at(-1));
    if (target === cell) return;
    const fieldX = (scroller.scrollLeft + focus.x - offset.x) / cell;
    const fieldY = (scroller.scrollTop + focus.y - offset.y) / cell;
    cell = target;
    layout();
    scroller.scrollLeft = fieldX * cell + offset.x - focus.x;
    scroller.scrollTop = fieldY * cell + offset.y - focus.y;
    requestDraw();
  }

  const zoomStep = (direction) => {
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > cell) ?? ZOOM_STEPS.at(-1))
        : ([...ZOOM_STEPS].reverse().find((step) => step < cell) ?? ZOOM_STEPS[0]);
    zoomTo(next);
  };

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /** Gelände in der Auflösung der aktuellen Zoomstufe; geänderte Felder werden nachgezeichnet. */
  function terrainImage() {
    const resolution = clamp(Math.round(cell * pixelRatio()), 12, CELL_PX);
    const cache = terrainCache;
    const sameBase =
      cache &&
      cache.resolution === resolution &&
      cache.cols === scene.cols &&
      cache.rows === scene.rows &&
      cache.ground === scene.ground;
    if (sameBase && cache.terrain === scene.terrain) return cache.canvas;
    const target = sameBase ? cache.canvas : document.createElement('canvas');
    if (!sameBase) {
      target.width = scene.cols * resolution;
      target.height = scene.rows * resolution;
    }
    const ctx = target.getContext('2d');
    if (sameBase) {
      // Nur den Bereich der geänderten Felder neu zeichnen (Malen bleibt flüssig).
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let index = 0; index < scene.terrain.length; index += 1) {
        if (scene.terrain[index] === cache.terrain[index]) continue;
        const x = index % scene.cols;
        const y = (index - x) / scene.cols;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      renderTerrain(ctx, scene, resolution, { x0: x0 - 1, y0: y0 - 1, x1: x1 + 2, y1: y1 + 2 });
    } else {
      renderTerrain(ctx, scene, resolution);
    }
    terrainCache = {
      canvas: target,
      resolution,
      cols: scene.cols,
      rows: scene.rows,
      ground: scene.ground,
      terrain: scene.terrain,
    };
    return target;
  }

  function draw() {
    frame = 0;
    const width = scroller.clientWidth;
    const height = scroller.clientHeight;
    if (!width || !height) return;
    const ratio = pixelRatio();
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const left = offset.x - scroller.scrollLeft;
    const top = offset.y - scroller.scrollTop;
    ctx.translate(left, top);
    ctx.drawImage(terrainImage(), 0, 0, scene.cols * cell, scene.rows * cell);
    if (showGrid) drawGridLines(ctx, scene.cols, scene.rows, cell);
    const view = { x0: -left / cell, y0: -top / cell, x1: (width - left) / cell, y1: (height - top) / cell };
    renderObjects(ctx, scene, cell, view);
    const current = selected();
    if (current) drawSelection(ctx, current, cell);
  }

  /** Bildschirmpunkt → Feldkoordinaten. */
  function toField(event) {
    const rect = scroller.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left + scroller.scrollLeft - offset.x) / cell,
      y: (event.clientY - rect.top + scroller.scrollTop - offset.y) / cell,
    };
  }

  // ---------------------------------------------------------------------------
  // Gesten
  // ---------------------------------------------------------------------------

  const pointers = new Map();
  let gesture = null;

  const center = () => {
    const points = [...pointers.values()];
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  };

  /** Laufende Geste abschließen: Änderungen kommen als ein Schritt in „Rückgängig“. */
  function finishGesture() {
    if (gesture?.before && gesture.before !== scene) remember(gesture.before);
    gesture = null;
  }

  function startGesture(event) {
    const point = toField(event);
    const base = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      moved: false,
    };
    if (mode === 'gelaende') {
      gesture = { ...base, kind: 'malen', before: scene, last: point };
      setScene(paintStroke(scene, point, null, terrainCode, brush), { record: false });
      return;
    }
    const tolerance = 10 / cell; // kleine Objekte lassen sich auch am Handy treffen
    const hit = objectAt(scene, point.x, point.y, tolerance);
    if (mode === 'objekte' && hit?.id !== selectedId) {
      gesture = { ...base, kind: 'setzen', point };
      return;
    }
    if (hit) {
      selectObject(hit.id);
      gesture = {
        ...base,
        kind: 'schieben',
        before: scene,
        id: hit.id,
        grabX: point.x - hit.x,
        grabY: point.y - hit.y,
      };
      return;
    }
    if (mode !== 'objekte') selectObject(null);
    gesture = { ...base, kind: 'ansicht' };
  }

  scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button > 0) return;
    scroller.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      // Zweiter Finger: ab jetzt nur noch die Ansicht verschieben.
      finishGesture();
      const middle = center();
      gesture = {
        kind: 'zwei',
        startX: middle.x,
        startY: middle.y,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      return;
    }
    if (pointers.size === 1) startGesture(event);
  });

  scroller.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture) return;
    if (gesture.kind === 'zwei') {
      const middle = center();
      scroller.scrollLeft = gesture.scrollLeft - (middle.x - gesture.startX);
      scroller.scrollTop = gesture.scrollTop - (middle.y - gesture.startY);
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > TAP_TOLERANCE_PX) gesture.moved = true;
    if (gesture.kind === 'ansicht' || gesture.kind === 'setzen') {
      if (!gesture.moved) return;
      scroller.scrollLeft = gesture.scrollLeft - dx;
      scroller.scrollTop = gesture.scrollTop - dy;
    } else if (gesture.kind === 'schieben') {
      if (!gesture.moved) return;
      const point = toField(event);
      const object = scene.objects.find((entry) => entry.id === gesture.id);
      if (!object) return;
      let x = point.x - gesture.grabX;
      let y = point.y - gesture.grabY;
      if (snap) ({ x, y } = snapObject(object.type, x, y, snapRotation(object), object.scale));
      setScene(updateObject(scene, gesture.id, { x, y }), { record: false });
    } else if (gesture.kind === 'malen') {
      const point = toField(event);
      setScene(paintStroke(scene, gesture.last, point, terrainCode, brush), { record: false });
      gesture.last = point;
    }
  });

  function endPointer(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (!gesture) return;
    if (gesture.kind === 'zwei') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    if (gesture.kind === 'setzen' && !gesture.moved && event.type === 'pointerup') placeObject(gesture.point);
    finishGesture();
  }
  scroller.addEventListener('pointerup', endPointer);
  scroller.addEventListener('pointercancel', endPointer);
  scroller.addEventListener('scroll', requestDraw, { passive: true });
  scroller.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return; // normales Rad scrollt
      event.preventDefault();
      const rect = scroller.getBoundingClientRect();
      zoomTo(cell * (event.deltaY < 0 ? 1.15 : 1 / 1.15), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    { passive: false },
  );

  /** Runde Naturobjekte rasten unabhängig von ihrer (zufälligen) Drehung ein. */
  const snapRotation = (object) => (objectType(object.type)?.group === 'natur' ? 0 : object.rot);

  function placeObject(point) {
    const definition = objectType(placeType);
    if (!definition) return;
    const natural = definition.group === 'natur';
    const rot = natural ? Math.floor(Math.random() * 360) : 0;
    let { x, y } = point;
    if (snap) ({ x, y } = snapObject(placeType, x, y, 0));
    const result = addObject(scene, { type: placeType, x, y, rot, scale: 1, seed: randomSeed() });
    if (!result.object) {
      showToast(`Höchstens ${MAX_OBJECTS} Objekte je Karte.`);
      return;
    }
    setScene(result.scene);
    selectObject(result.object.id);
  }

  // ---------------------------------------------------------------------------
  // Gewähltes Objekt
  // ---------------------------------------------------------------------------

  const selectionName = h('strong', { class: 'map-editor-selection-name' });
  const changeSelected = (changes) => {
    const current = selected();
    if (current) setScene(updateObject(scene, current.id, changes(current)));
  };
  const actionButton = (label, title, onClick, className = 'btn btn-small') =>
    h('button', { type: 'button', class: className, title, 'aria-label': title, onclick: onClick }, label);
  const selectionBar = h(
    'div',
    { class: 'map-editor-selection', hidden: true },
    selectionName,
    h(
      'div',
      { class: 'map-editor-selection-actions' },
      actionButton('↺', 'Nach links drehen', () => changeSelected((object) => ({ rot: object.rot - ROTATE_STEP }))),
      actionButton('↻', 'Nach rechts drehen', () => changeSelected((object) => ({ rot: object.rot + ROTATE_STEP }))),
      actionButton('−', 'Kleiner', () =>
        changeSelected((object) => ({ scale: clampScale(object.scale - SCALE_STEP) })),
      ),
      actionButton('+', 'Größer', () => changeSelected((object) => ({ scale: clampScale(object.scale + SCALE_STEP) }))),
      actionButton('Variante', 'Anderes Aussehen', () => changeSelected(() => ({ seed: randomSeed() }))),
      actionButton('Kopie', 'Kopieren', () => {
        const current = selected();
        if (!current) return;
        const result = addObject(scene, { ...current, x: current.x + 1, y: current.y + 1, seed: randomSeed() });
        if (!result.object) {
          showToast(`Höchstens ${MAX_OBJECTS} Objekte je Karte.`);
          return;
        }
        setScene(result.scene);
        selectObject(result.object.id);
      }),
      actionButton(
        'Entfernen',
        'Objekt entfernen',
        () => {
          const current = selected();
          if (current) setScene(removeObject(scene, current.id));
        },
        'btn btn-small btn-danger-outline',
      ),
    ),
  );

  function updateSelection() {
    const current = selected();
    selectionBar.hidden = !current;
    if (!current) return;
    const definition = objectType(current.type);
    const size = current.scale === 1 ? '' : ` · ${Math.round(current.scale * 100)} %`;
    selectionName.textContent = `${definition?.name ?? 'Objekt'}${current.rot ? ` · ${current.rot}°` : ''}${size}`;
  }

  // ---------------------------------------------------------------------------
  // Werkzeugleisten
  // ---------------------------------------------------------------------------

  const nameInput = h('input', {
    type: 'text',
    value: map?.name ?? THEMES[0].name,
    maxlength: MAX_MAP_NAME_LENGTH,
    autocomplete: 'off',
    oninput: () => {
      nameTouched = true;
    },
  });

  const panel = h('div', { class: 'map-editor-panel' });

  function generate() {
    const size = editing ? { cols: scene.cols, rows: scene.rows } : sizeOf(sizeId);
    setScene(generateScene({ theme, cols: size.cols, rows: size.rows, seed: randomSeed() }));
    if (!nameTouched) nameInput.value = THEMES.find((entry) => entry.id === theme)?.name ?? nameInput.value;
    selectObject(null);
    renderPanel();
  }

  function emptyMap() {
    const size = editing ? { cols: scene.cols, rows: scene.rows } : sizeOf(sizeId);
    setScene(createScene({ cols: size.cols, rows: size.rows, ground: scene.ground }));
    if (!nameTouched) nameInput.value = 'Eigene Karte';
    selectObject(null);
  }

  function mapPanel() {
    return [
      h(
        'div',
        { class: 'map-editor-row' },
        field('Name', nameInput),
        field(
          'Boden',
          select(GROUNDS, scene.ground, (id) => {
            setScene(setGround(scene, id));
            renderTerrainSwatches();
          }),
        ),
      ),
      h(
        'div',
        { class: 'map-editor-row' },
        field(
          'Vorlage',
          select(THEMES, theme, (id) => {
            theme = id;
          }),
        ),
        field(
          'Größe',
          select(
            editing ? [{ id: 'fest', name: `${scene.cols} × ${scene.rows}` }] : SCENE_SIZES,
            editing ? 'fest' : sizeId,
            (id) => {
              sizeId = id;
            },
            editing,
          ),
        ),
      ),
      h(
        'div',
        { class: 'map-editor-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: generate }, 'Automatisch erstellen'),
        h('button', { type: 'button', class: 'btn', onclick: emptyMap }, 'Leere Karte'),
      ),
      h(
        'p',
        { class: 'field-hint' },
        editing
          ? 'Die Größe bleibt beim Bearbeiten gleich – Figuren bleiben an ihrem Platz.'
          : 'Automatisch erstellen würfelt jedes Mal eine neue Karte zur Vorlage. „Rückgängig“ holt die vorige zurück.',
      ),
    ];
  }

  const objectButtons = OBJECTS.map((definition) =>
    h(
      'button',
      {
        type: 'button',
        class: 'map-editor-choice',
        'aria-label': definition.name,
        'aria-pressed': String(definition.id === placeType),
        onclick: () => {
          placeType = definition.id;
          objectButtons.forEach((button, index) =>
            button.setAttribute('aria-pressed', String(OBJECTS[index].id === placeType)),
          );
        },
      },
      iconCanvas((ctx, size) => drawObjectIcon(ctx, definition.id, size)),
      h('span', {}, definition.name),
    ),
  );

  function objectPanel() {
    return [
      h(
        'div',
        { class: 'map-editor-palette' },
        OBJECT_GROUPS.map((group) => [
          h('span', { class: 'map-editor-palette-group' }, group.name),
          objectButtons.filter((_, index) => OBJECTS[index].group === group.id),
        ]),
      ),
      h('p', { class: 'field-hint' }, 'Antippen setzt das Objekt. Ein gewähltes Objekt lässt sich ziehen.'),
    ];
  }

  const terrainButtons = TERRAINS.map((terrain) =>
    h(
      'button',
      {
        type: 'button',
        class: 'map-editor-choice',
        'aria-label': terrain.name,
        'aria-pressed': String(terrain.code === terrainCode),
        onclick: () => {
          terrainCode = terrain.code;
          terrainButtons.forEach((button, index) =>
            button.setAttribute('aria-pressed', String(TERRAINS[index].code === terrainCode)),
          );
        },
      },
      h('canvas', { class: 'map-editor-icon' }),
      h('span', {}, terrain.name),
    ),
  );

  function renderTerrainSwatches() {
    const ratio = pixelRatio();
    terrainButtons.forEach((button, index) => {
      const swatch = button.querySelector('canvas');
      swatch.width = ICON_PX * ratio;
      swatch.height = ICON_PX * ratio;
      swatch.style.width = `${ICON_PX}px`;
      swatch.style.height = `${ICON_PX}px`;
      const ctx = swatch.getContext('2d');
      if (ctx) drawTerrainSwatch(ctx, TERRAINS[index].code, scene.ground, ICON_PX * ratio);
    });
  }

  function terrainPanel() {
    return [
      h('div', { class: 'map-editor-palette' }, terrainButtons),
      field(
        'Pinsel',
        segmentedControl(
          BRUSHES,
          String(brush),
          (id) => {
            brush = Number(id);
          },
          'Pinselgröße',
        ),
      ),
      h('p', { class: 'field-hint' }, 'Ziehen malt. Mit zwei Fingern verschiebst du die Ansicht.'),
    ];
  }

  function selectPanel() {
    return [
      h(
        'p',
        { class: 'field-hint' },
        'Objekt antippen, um es zu wählen; ziehen verschiebt es. Leere Stellen ziehen verschiebt die Ansicht.',
      ),
    ];
  }

  function renderPanel() {
    const content = { karte: mapPanel, objekte: objectPanel, gelaende: terrainPanel, auswahl: selectPanel }[mode];
    setChildren(panel, content());
    stage.dataset.mode = mode;
  }

  const modes = segmentedControl(
    MODES,
    mode,
    (id) => {
      mode = id;
      renderPanel();
    },
    'Werkzeug',
  );

  const undoButton = h(
    'button',
    { type: 'button', class: 'btn btn-small', title: 'Rückgängig', 'aria-label': 'Rückgängig', onclick: undoLast },
    '↶',
  );
  const count = h('span', { class: 'map-editor-count' });
  const toggle = (label, value, onChange) => {
    const input = h('input', { type: 'checkbox', checked: value, onchange: () => onChange(input.checked) });
    return h('label', { class: 'map-editor-toggle' }, input, label);
  };
  const tools = h(
    'div',
    { class: 'map-editor-tools' },
    undoButton,
    toggle('Raster', showGrid, (value) => {
      showGrid = value;
      requestDraw();
    }),
    toggle('Einrasten', snap, (value) => {
      snap = value;
    }),
    count,
  );

  // Zoomknöpfe schweben über der Karte (wie in Karten-Apps), so bleibt die Werkzeugleiste kurz.
  stage.append(
    h(
      'div',
      { class: 'map-editor-zoom' },
      actionButton('+', 'Vergrößern', () => zoomStep(1)),
      actionButton(icon(ICONS.expand), 'Ganze Karte zeigen', fitZoom),
      actionButton('−', 'Verkleinern', () => zoomStep(-1)),
    ),
  );

  function updateTools() {
    undoButton.disabled = undo.length === 0;
    count.textContent = `${scene.objects.length} Objekte`;
  }

  // ---------------------------------------------------------------------------
  // Speichern
  // ---------------------------------------------------------------------------

  const saveButton = h('button', { type: 'button', class: 'btn btn-primary' }, 'Speichern');
  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || (editing ? map.name : 'Eigene Karte');
    saveButton.disabled = true;
    saveButton.textContent = 'wird gespeichert …';
    try {
      // Beim Bearbeiten genau so groß wie bisher – sonst stünden Figuren an falscher Stelle.
      const cellSizes = editing ? [map.width / scene.cols] : NEW_MAP_CELL_SIZES;
      const image = await sceneImage(scene, cellSizes);
      if (editing) {
        await controller.actions.updateBuiltMap(map.id, { name, ...image, scene });
      } else {
        await controller.actions.createBuiltMap({ name, ...image, grid: sceneGrid(image.cellPx), scene });
      }
      changed = false;
      dialog.close(); // erst schließen: Meldungen in einem Dialog verschwinden mit ihm
      showToast(
        editing
          ? `Karte „${name}“ gespeichert.`
          : `Karte „${name}“ gespeichert – nur du siehst sie, bis du sie zeigst.`,
      );
    } catch (error) {
      showError(error, 'Nicht gespeichert');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Speichern';
    }
  });

  dialog.element.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoLast();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected()) {
      event.preventDefault();
      setScene(removeObject(scene, selectedId));
    }
  });

  dialog.body.classList.add('map-editor-body');
  dialog.body.append(
    h('div', { class: 'map-editor-side' }, modes, panel, selectionBar),
    h('div', { class: 'map-editor-main' }, stage, tools),
  );
  dialog.footer.append(
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.requestClose() }, 'Abbrechen'),
    saveButton,
  );

  const resizeObserver = new ResizeObserver(() => {
    if (!fitted) fitZoom();
    else layout();
  });
  resizeObserver.observe(scroller);
  renderTerrainSwatches();
  renderPanel();
  updateSelection();
  updateTools();
}
