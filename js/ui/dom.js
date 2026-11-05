/**
 * dom.js – Sicheres Erzeugen von DOM-Elementen.
 * Texte werden immer als Textknoten eingefügt (nie als HTML), damit Eingaben
 * anderer Spieler keinen Code einschleusen können.
 */

const PROPERTY_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'open', 'textContent']);

/**
 * h('button', { class: 'btn', onclick: fn, dataset: { action: 'x' } }, 'Text', kindElement)
 * - Attribute mit null/undefined/false werden ausgelassen.
 * - on…-Funktionen werden als Event-Listener registriert.
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (PROPERTY_KEYS.has(key)) element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** SVG-Symbol aus einer Pfadangabe (für Icons ohne externe Dateien). */
export function icon(pathData, label = null) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

/** Icon-Pfade (24×24, Linienstil) */
export const ICONS = Object.freeze({
  hero: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  group:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  minus: 'M5 12h14',
  fit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  expand: 'M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6',
  select: 'M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4',
  ping: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  pen: 'M3 21l1.5-5.5L15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8.5 19.5 3 21zM13.5 6.5l4 4',
  eraser: 'M9 20h11M4.5 14.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 20H8l-3.5-3.5a1.4 1.4 0 0 1 0-2zM9 10l5 5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  check: 'M5 12.5l4.5 4.5L19 7',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2',
  line: 'M5 19L19 5',
  arrow: 'M5 19L18 6M10 5.5h8.5V14',
  rect: 'M4 6.5h16v11H4z',
  ellipse: 'M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5-8-2.9-8-6.5 3.6-6.5 8-6.5z',
  bucket:
    'M11 3.5l7.5 7.5-6.5 6.5a2 2 0 0 1-2.8 0L4.5 12.8a2 2 0 0 1 0-2.8L11 3.5zM4.8 11h13.4M20.5 15.5s1.5 1.8 1.5 3a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3z',
  palette:
    'M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9a4.8 4.8 0 0 0 4.8-4.8C21.1 6.6 17 3 12 3zM7.5 12.5h.01M9 8h.01M14 7h.01M17.5 10.5h.01',
});

/**
 * Ersetzt den Inhalt eines Elements. Wie h(): Arrays werden aufgelöst,
 * null/undefined/false ausgelassen (natives replaceChildren würde „null“ als Text zeigen).
 */
export function setChildren(element, ...children) {
  element.replaceChildren();
  append(element, children);
}
