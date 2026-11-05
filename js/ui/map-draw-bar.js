/**
 * map-draw-bar.js – Stiftleiste unten auf der Karte. Erscheint nur, solange der Stift aktiv ist.
 *  - Werkzeuge: Stift (freihand), gerade Linie, Pfeil, Rechteck, Kreis, Farbeimer, Radierer.
 *  - Farben: sechs feste und „Eigene Farbe“ (Farbwähler mit Hex-Eingabe, zuletzt benutzte).
 *  - Strichstärke, Füllung von Rechteck/Kreis/Farbeimer, Rückgängig, Löschen, „Fertig“.
 * Der Meister löscht alle Zeichnungen, Spieler nur ihre eigenen. Die Wahl merkt sich das Gerät.
 */
import { h, icon, ICONS } from './dom.js';
import { openDialog } from './dialog.js';
import { showToast } from './toast.js';
import { readJson, writeJson } from '../storage.js';
import {
  DRAW_COLORS,
  DRAW_PALETTE,
  DRAW_FILLS,
  SHAPE_KINDS,
  drawColorValue,
  normalizeColor,
  normalizeDrawWidth,
  widthFromSlider,
  sliderFromWidth,
} from '../map.js';

const STYLE_KEY = 'dsa5.ui.stift';
const RECENT_KEY = 'dsa5.ui.stift-farben';
const MAX_RECENT_COLORS = 8;
/** Eigene Farbe, bevor man eine gewählt hat. */
const DEFAULT_CUSTOM_COLOR = '#ff7f00';

/** Werkzeuge in der Leiste: id, Bezeichnung, Symbol. */
export const DRAW_TOOLS = Object.freeze([
  { id: 'pen', name: 'Stift (freihand)', icon: ICONS.pen },
  { id: 'straight', name: 'Gerade Linie (mit Umschalttaste in 45°-Schritten)', icon: ICONS.line },
  { id: 'arrow', name: 'Pfeil (mit Umschalttaste in 45°-Schritten)', icon: ICONS.arrow },
  { id: 'rect', name: 'Rechteck (mit Umschalttaste: Quadrat)', icon: ICONS.rect },
  { id: 'ellipse', name: 'Kreis oder Ellipse (mit Umschalttaste: Kreis)', icon: ICONS.ellipse },
  { id: 'bucket', name: 'Farbeimer – Fläche antippen und füllen', icon: ICONS.bucket },
  { id: 'eraser', name: 'Radierer – über Zeichnungen wischen', icon: ICONS.eraser },
]);
const TOOL_IDS = DRAW_TOOLS.map((tool) => tool.id);
const isHex = (color) => typeof color === 'string' && color.startsWith('#');

/** Gespeicherte Stiftwahl des Geräts (unbekannte Werte → Standard). */
export function storedDrawStyle() {
  const stored = readJson(STYLE_KEY, null) ?? {};
  const color = normalizeColor(stored.color) ?? DRAW_COLORS[0].id;
  const custom = normalizeColor(stored.custom);
  return {
    // Der Radierer ist nach dem Wiederöffnen nie aus Versehen noch aktiv.
    tool: TOOL_IDS.includes(stored.tool) && stored.tool !== 'eraser' ? stored.tool : 'pen',
    color,
    width: normalizeDrawWidth(stored.width), // Anteil eines Felds (früher: Stufenname)
    fill: DRAW_FILLS.some((fill) => fill.id === stored.fill) ? stored.fill : 'keine',
    custom: isHex(custom) ? custom : isHex(color) ? color : DEFAULT_CUSTOM_COLOR,
    private: stored.private === true, // nur für mich malen
  };
}

/** Zuletzt benutzte eigene Farben (neueste zuerst). */
export function rememberCustomColor(recent, color) {
  return [color, ...recent.filter((entry) => entry !== color)].slice(0, MAX_RECENT_COLORS);
}

/**
 * Dialog „Eigene Farbe“: Farbwähler des Geräts, Hex-Eingabe und zuletzt benutzte Farben.
 * @param {string} current  '#rrggbb'
 * @param {(color: string) => void} onPick
 */
function openColorPicker(current, onPick) {
  const dialog = openDialog({ title: 'Eigene Farbe', className: 'dialog-small color-dialog' });
  let value = current;
  const native = h('input', { type: 'color', class: 'color-native', value, 'aria-label': 'Farbe wählen' });
  const hex = h('input', {
    type: 'text',
    class: 'color-hex',
    value: value.toUpperCase(),
    maxlength: 7,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    'aria-label': 'Farbe als Hex-Wert, z. B. #3A7BD5',
  });
  const preview = h('span', { class: 'color-preview', 'aria-hidden': 'true' });
  const error = h(
    'p',
    { class: 'error-text', hidden: true, role: 'alert' },
    'Bitte einen Hex-Wert wie #3A7BD5 eingeben.',
  );
  const apply = h('button', { type: 'button', class: 'btn btn-primary' }, 'Übernehmen');

  const show = (color, { fromHex = false } = {}) => {
    value = color;
    preview.style.background = color;
    native.value = color;
    if (!fromHex) hex.value = color.toUpperCase();
    apply.disabled = false;
    error.hidden = true;
  };
  native.addEventListener('input', () => show(native.value));
  hex.addEventListener('input', () => {
    const parsed = normalizeColor(hex.value);
    if (isHex(parsed)) {
      show(parsed, { fromHex: true });
      return;
    }
    apply.disabled = true;
    error.hidden = hex.value.replace('#', '').trim().length < 6;
  });
  hex.addEventListener('blur', () => {
    if (!apply.disabled) hex.value = value.toUpperCase();
  });
  const pick = () => {
    if (apply.disabled) return;
    onPick(value);
    dialog.close();
  };
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') pick();
  });
  apply.addEventListener('click', pick);

  const recent = readJson(RECENT_KEY, []);
  const recentColors = (Array.isArray(recent) ? recent : []).map(normalizeColor).filter(isHex);
  const parts = [
    h(
      'div',
      { class: 'color-picker' },
      h('label', { class: 'color-native-wrap' }, native, preview),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Hex-Wert'), hex),
    ),
    h(
      'p',
      { class: 'section-hint' },
      'Tippe auf das Farbfeld für den Farbwähler des Geräts – oder gib einen Hex-Wert ein.',
    ),
    error,
    recentColors.length
      ? h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Zuletzt benutzt'),
          h(
            'div',
            { class: 'color-recent' },
            recentColors.map((color) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'draw-swatch',
                  style: `--swatch: ${color}`,
                  'aria-label': color.toUpperCase(),
                  title: color.toUpperCase(),
                  onclick: () => show(color),
                },
                h('span', { class: 'draw-swatch-dot' }),
              ),
            ),
          ),
        )
      : null,
  ];
  dialog.body.append(...parts.filter(Boolean)); // ohne zuletzt benutzte Farben kein leerer Bereich
  dialog.footer.append(
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'),
    apply,
  );
  show(value);
  hex.focus({ preventScroll: true });
  hex.select();
}

/**
 * @param {object} options
 * @param {(style: {tool, color, width, fill, private}) => void} options.onChange  Werkzeug, Farbe, Stärke, Füllung oder „nur für mich“ geändert
 * @param {() => void} options.onUndo
 * @param {() => void} options.onClear
 * @param {() => void} options.onClose  „Fertig“: Stift weglegen
 * @param {() => boolean} [options.isMaster]  Meister löscht alle Zeichnungen, Spieler nur ihre eigenen
 */
export function createDrawBar({ onChange, onUndo, onClear, onClose, isMaster = () => true }) {
  let style = storedDrawStyle();

  const choose = (changes) => {
    style = { ...style, ...changes };
    writeJson(STYLE_KEY, {
      tool: style.tool,
      color: style.color,
      width: style.width,
      fill: style.fill,
      custom: style.custom,
      private: style.private,
    });
    refresh();
    onChange(style);
  };
  // Eine Farbe oder Stärke wählen heißt malen – der Radierer (bzw. Farbeimer) geht dabei aus.
  const toolFor = (keep) => (keep.includes(style.tool) ? style.tool : 'pen');

  const toolButtons = DRAW_TOOLS.map((tool) =>
    h(
      'button',
      {
        type: 'button',
        class: 'draw-tool',
        dataset: { tool: tool.id },
        'aria-label': tool.name,
        title: tool.name,
        onclick: () => choose({ tool: tool.id === 'eraser' && style.tool === 'eraser' ? 'pen' : tool.id }),
      },
      icon(tool.icon),
    ),
  );

  const colorButtons = DRAW_PALETTE.map((id) => {
    const color = DRAW_COLORS.find((entry) => entry.id === id);
    return h(
      'button',
      {
        type: 'button',
        class: 'draw-swatch',
        dataset: { color: id },
        'aria-label': color.name,
        title: color.name,
        style: `--swatch: ${color.value}`,
        onclick: () => choose({ color: id, tool: toolFor([...SHAPE_KINDS, 'pen', 'bucket']) }),
      },
      h('span', { class: 'draw-swatch-dot' }),
    );
  });
  const customButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-swatch draw-custom',
      'aria-label': 'Eigene Farbe wählen (Farbwähler, Hex-Wert)',
      title: 'Eigene Farbe',
      onclick: () =>
        openColorPicker(isHex(style.color) ? style.color : style.custom, (color) => {
          writeJson(RECENT_KEY, rememberCustomColor(readJson(RECENT_KEY, []) ?? [], color));
          choose({ color, custom: color, tool: toolFor([...SHAPE_KINDS, 'pen', 'bucket']) });
        }),
    },
    h('span', { class: 'draw-swatch-dot' }),
  );

  // Strichstärke frei wählbar: Schieberegler von hauchdünn bis dick, daneben der Punkt als Vorschau.
  const widthSlider = h('input', {
    type: 'range',
    class: 'draw-width-slider',
    min: 0,
    max: 100,
    step: 1,
    'aria-label': 'Strichstärke',
    title: 'Strichstärke',
  });
  widthSlider.addEventListener('input', () =>
    choose({ width: widthFromSlider(widthSlider.value), tool: toolFor([...SHAPE_KINDS, 'pen']) }),
  );
  const widthDot = h('span', { class: 'draw-width-dot', 'aria-hidden': 'true' });
  const widthControl = h('label', { class: 'draw-width' }, widthDot, widthSlider);
  // Füllung: ohne → halb durchsichtig → deckend (gilt für Rechteck, Kreis und Farbeimer).
  const fillButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool draw-fill',
      onclick: () => {
        const index = DRAW_FILLS.findIndex((fill) => fill.id === style.fill);
        choose({ fill: DRAW_FILLS[(index + 1) % DRAW_FILLS.length].id });
      },
    },
    h('span', { class: 'draw-fill-icon' }),
  );
  // Nur für mich: Was man dann malt, sieht niemand sonst (auch nicht der Meister) – z. B. eigene Notizen.
  const privacyButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool draw-privacy',
      onclick: () => {
        choose({ private: !style.private });
        showToast(
          style.private
            ? '🔒 Nur für dich: Was du jetzt malst, sieht niemand sonst – auch nicht der Meister.'
            : 'Für alle: Was du jetzt malst, sehen wieder alle.',
        );
      },
    },
    icon(ICONS.group),
  );
  const undoButton = h(
    'button',
    {
      type: 'button',
      class: 'draw-tool',
      'aria-label': 'Rückgängig (eigene letzte Zeichnung entfernen)',
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
      'aria-label': 'Alle Zeichnungen auf dieser Karte löschen',
      title: 'Alles löschen',
      onclick: () => onClear(),
    },
    icon(ICONS.trash),
  );
  // Am Handy nur ein Haken (spart Platz), sonst „Fertig“ ausgeschrieben.
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
    h('div', { class: 'draw-group', role: 'group', 'aria-label': 'Werkzeug' }, toolButtons),
    h('div', { class: 'draw-group', role: 'group', 'aria-label': 'Farbe' }, colorButtons, customButton),
    h(
      'div',
      { class: 'draw-group draw-options', role: 'group', 'aria-label': 'Strich und Füllung' },
      widthControl,
      fillButton,
      privacyButton,
      undoButton,
      clearButton,
      doneButton,
    ),
  );

  function refresh() {
    const painting = style.tool !== 'eraser';
    for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === style.tool));
    for (const button of colorButtons) {
      button.setAttribute('aria-pressed', String(painting && button.dataset.color === style.color));
    }
    customButton.style.setProperty('--swatch', style.custom);
    customButton.setAttribute('aria-pressed', String(painting && isHex(style.color)));
    const position = sliderFromWidth(style.width);
    if (Number(widthSlider.value) !== position && document.activeElement !== widthSlider) {
      widthSlider.value = String(position);
    }
    // Vorschau: 2 bis 22 Punkte, in der Stiftfarbe
    widthDot.style.setProperty('--dot', `${Math.round(2 + (Number(widthSlider.value) / 100) * 20)}px`);
    widthDot.style.setProperty('--swatch', drawColorValue(style.color));
    widthSlider.setAttribute('aria-valuetext', `${Math.round(normalizeDrawWidth(style.width) * 100)} % eines Felds`);
    const fill = DRAW_FILLS.find((entry) => entry.id === style.fill) ?? DRAW_FILLS[0];
    fillButton.dataset.fill = fill.id;
    fillButton.style.setProperty('--swatch', drawColorValue(style.color));
    fillButton.setAttribute('aria-label', `${fill.name} (für Rechteck, Kreis und Farbeimer) – antippen zum Wechseln`);
    fillButton.title = fill.name;
    privacyButton.setAttribute('aria-pressed', String(style.private));
    privacyButton.setAttribute(
      'aria-label',
      style.private
        ? 'Nur für mich – was du malst, sieht niemand sonst. Antippen: für alle'
        : 'Für alle sichtbar. Antippen: nur für mich malen',
    );
    privacyButton.title = style.private ? 'Nur für mich' : 'Für alle sichtbar';
    privacyButton.replaceChildren(icon(style.private ? ICONS.lock : ICONS.group));
    element.classList.toggle('is-private', style.private);
    element.dataset.tool = style.tool;
  }
  refresh();

  return {
    element,
    style: () => style,
    /** Leiste zeigen oder verstecken; beim Zeigen ist nie der Radierer aktiv. */
    setOpen(open) {
      element.hidden = !open;
      if (open && style.tool === 'eraser') choose({ tool: 'pen' });
    },
    /**
     * Rückgängig nur mit eigenen Zeichnungen, Löschen nur mit solchen, die man löschen darf.
     * @param {{ own: number, removable: number }} counts
     */
    setCounts({ own, removable }) {
      undoButton.disabled = own === 0;
      clearButton.disabled = removable === 0;
      const label = isMaster()
        ? 'Alle Zeichnungen auf dieser Karte löschen'
        : 'Meine Zeichnungen auf dieser Karte löschen';
      clearButton.setAttribute('aria-label', label);
      clearButton.title = isMaster() ? 'Alles löschen' : 'Meine Zeichnungen löschen';
    },
  };
}
