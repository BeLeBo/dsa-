/**
 * map-draw-bar.js – Stiftleiste des Meisters unten auf der Karte: Farbe, Strichstärke, Radierer,
 * Rückgängig, alles löschen und „Fertig“. Erscheint nur, solange der Stift aktiv ist.
 * Die Wahl (Farbe, Stärke) merkt sich das Gerät.
 */
import { h, icon, ICONS } from './dom.js';
import { readJson, writeJson } from '../storage.js';
import { DRAW_COLORS, DRAW_WIDTHS } from '../map.js';

const STYLE_KEY = 'dsa5.ui.stift';

/** Gespeicherte Stiftwahl des Geräts (unbekannte Werte → Standard). */
export function storedDrawStyle() {
  const stored = readJson(STYLE_KEY, null) ?? {};
  return {
    tool: 'pen', // Der Radierer ist nach dem Wiederöffnen nie aus Versehen noch aktiv.
    color: DRAW_COLORS.some((color) => color.id === stored.color) ? stored.color : DRAW_COLORS[0].id,
    width: DRAW_WIDTHS.some((width) => width.id === stored.width) ? stored.width : 'mittel',
  };
}

/**
 * @param {object} options
 * @param {(style: {tool, color, width}) => void} options.onChange  Werkzeug, Farbe oder Stärke geändert
 * @param {() => void} options.onUndo
 * @param {() => void} options.onClear
 * @param {() => void} options.onClose  „Fertig“: Stift weglegen
 */
export function createDrawBar({ onChange, onUndo, onClear, onClose }) {
  let style = storedDrawStyle();

  const choose = (changes) => {
    style = { ...style, ...changes };
    writeJson(STYLE_KEY, { color: style.color, width: style.width });
    refresh();
    onChange(style);
  };

  const colorButtons = DRAW_COLORS.map((color) =>
    h(
      'button',
      {
        type: 'button',
        class: 'draw-swatch',
        dataset: { color: color.id },
        'aria-label': color.name,
        title: color.name,
        style: `--swatch: ${color.value}`,
        // Eine Farbe wählen heißt malen – der Radierer geht dabei aus.
        onclick: () => choose({ color: color.id, tool: 'pen' }),
      },
      h('span', { class: 'draw-swatch-dot' }),
    ),
  );
  const widthButtons = DRAW_WIDTHS.map((width, index) =>
    h(
      'button',
      {
        type: 'button',
        class: 'draw-tool draw-width',
        dataset: { width: width.id },
        'aria-label': `Strich ${width.name.toLowerCase()}`,
        title: width.name,
        onclick: () => choose({ width: width.id, tool: 'pen' }),
      },
      h('span', { class: 'draw-width-dot', style: `--dot: ${4 + index * 5}px` }),
    ),
  );
  const eraserButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool',
      'aria-label': 'Radierer – über Linien wischen',
      title: 'Radierer',
      onclick: () => choose({ tool: style.tool === 'eraser' ? 'pen' : 'eraser' }),
    },
    icon(ICONS.eraser),
  );
  const undoButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool',
      'aria-label': 'Rückgängig (letzte Linie entfernen)',
      title: 'Rückgängig',
      onclick: () => onUndo(),
    },
    icon(ICONS.undo),
  );
  const clearButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool',
      'aria-label': 'Alle Linien auf dieser Karte löschen',
      title: 'Alles löschen',
      onclick: () => onClear(),
    },
    icon(ICONS.trash),
  );
  // Am Handy nur ein Haken (spart eine Zeile), sonst „Fertig“ ausgeschrieben.
  const doneButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary draw-done',
      'aria-label': 'Fertig – Stift weglegen',
      onclick: () => onClose(),
    },
    icon(ICONS.check),
    h('span', { class: 'draw-done-label' }, 'Fertig'),
  );

  const element = h(
    'div',
    { class: 'map-draw-bar', role: 'toolbar', 'aria-label': 'Stift', hidden: true },
    h('div', { class: 'draw-group', role: 'group', 'aria-label': 'Farbe' }, colorButtons),
    h(
      'div',
      { class: 'draw-group', role: 'group', 'aria-label': 'Werkzeug' },
      widthButtons,
      eraserButton,
      undoButton,
      clearButton,
      doneButton,
    ),
  );

  function refresh() {
    const pen = style.tool === 'pen';
    for (const button of colorButtons) {
      button.setAttribute('aria-pressed', String(pen && button.dataset.color === style.color));
    }
    for (const button of widthButtons) {
      button.setAttribute('aria-pressed', String(pen && button.dataset.width === style.width));
    }
    eraserButton.setAttribute('aria-pressed', String(!pen));
    element.dataset.tool = style.tool;
  }
  refresh();

  return {
    element,
    style: () => style,
    /** Leiste zeigen oder verstecken; beim Zeigen ist immer der Stift (nicht der Radierer) aktiv. */
    setOpen(open) {
      element.hidden = !open;
      if (open && style.tool !== 'pen') choose({ tool: 'pen' });
    },
    /** Rückgängig und Löschen nur, wenn es Linien gibt. */
    setCount(count) {
      undoButton.disabled = count === 0;
      clearButton.disabled = count === 0;
    },
  };
}
