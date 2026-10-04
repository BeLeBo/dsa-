/**
 * map-render.js – Zeichnet eine Szene aus dem Karten-Editor (map-editor.js) auf eine Leinwand:
 * Untergrund mit Struktur, gemaltes Gelände mit natürlichen Rändern und alle Objekte
 * (Bäume, Hütten, Felsen …) – alles per Code gezeichnet, ohne Bilddateien.
 *
 * Gezeichnet wird in Feldern: die Funktionen skalieren die Leinwand selbst auf cellPx.
 * Gleiche Szene → gleiches Bild (alle Zufälle hängen nur von Feld bzw. Objekt-seed ab).
 */
import { createRandom, drawOrder, objectType } from './map-editor.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Ganzzahliger Streuwert je Feld (wiederholbar). */
function hash(x, y, salt) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

const cellRandom = (x, y, salt) => createRandom(hash(x, y, salt));

/** Farbe aufhellen (amount > 0) oder abdunkeln (amount < 0). */
export function shade(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const mix = Math.abs(amount);
  const channel = (shift) => {
    const current = (value >> shift) & 255;
    return Math.round(current + (target - current) * mix);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function circle(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, color, width) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Unregelmäßiges Vieleck um (0, 0). */
function lumpy(random, corners, min, max) {
  const turn = random.range(0, TAU);
  return Array.from({ length: corners }, (_, index) => {
    const angle = turn + (index / corners) * TAU + random.range(-0.2, 0.2);
    const radius = random.range(min, max);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

/** Stern (von oben gesehener Nadelbaum). */
function star(ctx, random, corners, outer, inner, turn, color) {
  const points = [];
  for (let index = 0; index < corners * 2; index += 1) {
    const angle = turn + (index / (corners * 2)) * TAU;
    const radius = (index % 2 ? inner : outer) * random.range(0.9, 1.05);
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  polygon(ctx, points, color);
}

// ---------------------------------------------------------------------------
// Untergrund und Gelände
// ---------------------------------------------------------------------------

/** Aussehen der Böden: Grundfarbe, Sprenkelfarben, Art der Struktur. */
const STYLES = {
  gras: { base: '#78a052', marks: ['#668f45', '#8ab562', '#5f8a40'], kind: 'tuft' },
  waldboden: { base: '#5b6a3a', marks: ['#6e5a3b', '#4b5930', '#7d6b41'], kind: 'leaf' },
  erde: { base: '#8a6a45', marks: ['#76583a', '#9b7b53'], kind: 'dot' },
  sand: { base: '#dcc58f', marks: ['#c9b07a', '#ead9ab'], kind: 'dot' },
  stein: { base: '#6f6b64', marks: ['#615d57', '#7d7972'], kind: 'pebble' },
  schnee: { base: '#eef2f6', marks: ['#dbe3ec', '#ffffff'], kind: 'dot' },
  dielen: { base: '#9c6d42', marks: ['#7d5532', '#a97a4d'], kind: 'planks' },
  weg: { base: '#a88b5e', marks: ['#8f7449', '#bea275'], kind: 'dot' },
  pflaster: { base: '#7f7a71', marks: ['#a39d93', '#979186', '#aca69b'], kind: 'cobble' },
  wasser: { base: '#3d7ea6', edge: '#2b5d7c', marks: ['rgba(255, 255, 255, 0.28)'], kind: 'ripple' },
  fels: { base: '#463f38', edge: '#2a2622', marks: ['#564e45', '#3a342e'], kind: 'rock' },
};

/** Gemaltes Gelände in Zeichenreihenfolge; round: natürliche, runde Ränder. */
const TERRAIN_LAYERS = [
  { code: 'g', style: 'gras', round: true },
  { code: 'e', style: 'erde', round: true },
  { code: 's', style: 'sand', round: true },
  { code: 'w', style: 'weg', round: true },
  { code: '~', style: 'wasser', round: true },
  { code: 'p', style: 'pflaster', round: false },
  { code: 'd', style: 'dielen', round: false },
  { code: 'f', style: 'fels', round: true, radius: 0.72 },
];

/**
 * Füllt Felder als zusammenhängende Fläche. Bei round sitzen Kreise auf den Feldmitten,
 * verbunden durch Rechtecke zwischen Nachbarn – das gibt weiche, leicht wellige Ränder.
 */
function fillCells(ctx, cells, member, color, { round, radius = 0.6, grow = 0, salt = 0 }) {
  ctx.beginPath();
  for (const [x, y] of cells) {
    if (!round) {
      ctx.rect(x - grow, y - grow, 1 + grow * 2, 1 + grow * 2);
      continue;
    }
    const random = cellRandom(x, y, salt);
    const cx = x + 0.5 + random.range(-0.04, 0.04);
    const cy = y + 0.5 + random.range(-0.04, 0.04);
    const r = radius + grow + random.range(-0.04, 0.06);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    const right = member(x + 1, y);
    const down = member(x, y + 1);
    // Zwischenkreise glätten den Rand zwischen zwei Nachbarn
    const between = radius + grow - 0.02;
    if (right) {
      ctx.rect(x + 0.5, y - grow, 1, 1 + grow * 2);
      ctx.moveTo(x + 1 + between, y + 0.5);
      ctx.arc(x + 1, y + 0.5, between, 0, TAU);
    }
    if (down) {
      ctx.rect(x - grow, y + 0.5, 1 + grow * 2, 1);
      ctx.moveTo(x + 0.5 + between, y + 1);
      ctx.arc(x + 0.5, y + 1, between, 0, TAU);
    }
    if (right && down && member(x + 1, y + 1)) ctx.rect(x + 0.5, y + 0.5, 1, 1);
  }
  ctx.fillStyle = color;
  ctx.fill();
}

/** Unregelmäßige Grundform für Felsflecken (Radien je Ecke). */
const ROCK_SHAPE = [1, 0.62, 0.9, 0.5, 0.8];

/** Struktur (Grasbüschel, Laub, Kiesel …) auf den Feldern, je Farbe ein Durchgang. */
function texture(ctx, cells, style, salt) {
  const { kind, marks } = style;
  if (kind === 'planks') return planks(ctx, cells, style, salt);
  if (kind === 'cobble') return cobbles(ctx, cells, style, salt);
  marks.forEach((color, colorIndex) => {
    ctx.beginPath();
    for (const [x, y] of cells) {
      const random = cellRandom(x, y, salt);
      const count = kind === 'ripple' ? 1 : kind === 'rock' ? 3 : 5;
      for (let index = 0; index < count; index += 1) {
        const px = x + random.range(0.08, 0.92);
        const py = y + random.range(0.08, 0.92);
        const pick = random.int(0, marks.length - 1);
        const size = random.range(0.6, 1.2);
        const turn = random.range(0, TAU);
        if (pick !== colorIndex) continue;
        if (kind === 'tuft') {
          ctx.moveTo(px - 0.06 * size, py);
          ctx.lineTo(px - 0.08 * size, py - 0.12 * size);
          ctx.moveTo(px, py);
          ctx.lineTo(px, py - 0.15 * size);
          ctx.moveTo(px + 0.06 * size, py);
          ctx.lineTo(px + 0.09 * size, py - 0.11 * size);
        } else if (kind === 'leaf') {
          ctx.moveTo(px + 0.07 * size * Math.cos(turn), py + 0.07 * size * Math.sin(turn));
          ctx.ellipse(px, py, 0.07 * size, 0.035 * size, turn, 0, TAU);
        } else if (kind === 'ripple') {
          if (random.chance(0.45)) {
            ctx.moveTo(px - 0.18, py);
            ctx.quadraticCurveTo(px, py - 0.07, px + 0.18, py);
          }
        } else if (kind === 'rock') {
          ROCK_SHAPE.forEach((radius, corner) => {
            const angle = turn + (corner / ROCK_SHAPE.length) * TAU;
            const cx = px + Math.cos(angle) * radius * 0.16 * size;
            const cy = py + Math.sin(angle) * radius * 0.16 * size;
            if (corner) ctx.lineTo(cx, cy);
            else ctx.moveTo(cx, cy);
          });
          ctx.closePath();
        } else {
          const r = (kind === 'pebble' ? 0.06 : 0.035) * size;
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, TAU);
        }
      }
    }
    if (kind === 'tuft' || kind === 'ripple') {
      ctx.strokeStyle = color;
      ctx.lineWidth = kind === 'ripple' ? 0.035 : 0.025;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
}

/** Holzdielen: Fugen längs, versetzte Stöße. */
function planks(ctx, cells, style, salt) {
  ctx.beginPath();
  for (const [x, y] of cells) {
    for (let row = 0; row < 3; row += 1) {
      const top = y + row / 3;
      ctx.moveTo(x, top);
      ctx.lineTo(x + 1, top);
      const joint = x + ((hash(x, y + row, salt) % 100) / 100) * 0.8 + 0.1;
      ctx.moveTo(joint, top);
      ctx.lineTo(joint, top + 1 / 3);
    }
  }
  ctx.strokeStyle = style.marks[0];
  ctx.lineWidth = 0.025;
  ctx.stroke();
}

/** Kopfsteinpflaster: je Feld vier gerundete Steine. */
function cobbles(ctx, cells, style, salt) {
  style.marks.forEach((color, colorIndex) => {
    ctx.beginPath();
    for (const [x, y] of cells) {
      const random = cellRandom(x, y, salt);
      for (let index = 0; index < 4; index += 1) {
        const left = x + (index % 2) * 0.5 + random.range(0.03, 0.06);
        const top = y + Math.floor(index / 2) * 0.5 + random.range(0.03, 0.06);
        const pick = random.int(0, style.marks.length - 1);
        if (pick !== colorIndex) continue;
        if (ctx.roundRect) ctx.roundRect(left, top, 0.4, 0.4, 0.1);
        else ctx.rect(left, top, 0.4, 0.4);
      }
    }
    ctx.fillStyle = color;
    ctx.fill();
  });
}

/** region (in Feldern): nur diesen Ausschnitt neu zeichnen – Nachbarn mit Rand zählen mit. */
function drawTerrain(ctx, cols, rows, terrain, ground, region = null) {
  const base = STYLES[ground] ?? STYLES.gras;
  rect(ctx, 0, 0, cols, rows, base.base);
  const x0 = region ? Math.max(0, Math.floor(region.x0) - 2) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y0) - 2) : 0;
  const x1 = region ? Math.min(cols, Math.ceil(region.x1) + 2) : cols;
  const y1 = region ? Math.min(rows, Math.ceil(region.y1) + 2) : rows;
  const all = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) all.push([x, y]);
  texture(ctx, all, base, 1);

  for (const layer of TERRAIN_LAYERS) {
    const member = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && terrain[y * cols + x] === layer.code;
    const cells = all.filter(([x, y]) => terrain[y * cols + x] === layer.code);
    if (!cells.length) continue;
    const style = STYLES[layer.style];
    const options = { round: layer.round, radius: layer.radius, salt: 7 };
    if (style.edge) fillCells(ctx, cells, member, style.edge, { ...options, grow: 0.1 });
    fillCells(ctx, cells, member, style.base, options);
    texture(ctx, cells, style, 3);
  }
}

/**
 * Untergrund und gemaltes Gelände (ohne Objekte).
 * @param {object} [region]  { x0, y0, x1, y1 } in Feldern: nur diesen Ausschnitt neu zeichnen
 */
export function renderTerrain(ctx, scene, cellPx, region = null) {
  ctx.save();
  ctx.scale(cellPx, cellPx);
  if (region) {
    ctx.beginPath();
    ctx.rect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);
    ctx.clip();
  }
  drawTerrain(ctx, scene.cols, scene.rows, scene.terrain, scene.ground, region);
  ctx.restore();
}

/** Kleines Musterfeld eines Geländes (für die Auswahl im Editor). */
export function drawTerrainSwatch(ctx, code, ground, sizePx) {
  ctx.save();
  ctx.scale(sizePx / 2, sizePx / 2);
  drawTerrain(ctx, 2, 2, code.repeat(4), ground);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Objekte (gezeichnet um den Mittelpunkt, eine Einheit = ein Feld)
// ---------------------------------------------------------------------------

const WOOD = '#8b6a43';
const WOOD_DARK = '#5e4328';
const STONE = '#8f8b84';
const STONE_DARK = '#6f6b64';

const DRAW = {
  laubbaum(ctx, random) {
    const autumn = random.chance(0.12);
    const base = autumn
      ? random.pick(['#a8652a', '#b5832e', '#9c4a25'])
      : random.pick(['#3f6b2a', '#466f2c', '#3b6430', '#4a7432']);
    circle(ctx, 0, 0, 0.9, shade(base, -0.3));
    const blobs = random.int(6, 8);
    for (let index = 0; index < blobs; index += 1) {
      const angle = (index / blobs) * TAU + random.range(-0.3, 0.3);
      const distance = random.range(0.38, 0.52);
      circle(ctx, Math.cos(angle) * distance, Math.sin(angle) * distance, random.range(0.32, 0.42), base);
    }
    circle(ctx, 0, 0, 0.5, base);
    for (let index = 0; index < 5; index += 1) {
      const angle = random.range(3.3, 4.7);
      const distance = random.range(0.15, 0.55);
      const color = shade(base, random.range(0.12, 0.28));
      circle(ctx, Math.cos(angle) * distance, Math.sin(angle) * distance, random.range(0.12, 0.22), color);
    }
  },
  nadelbaum(ctx, random) {
    const base = random.pick(['#2e5a3a', '#2b5236', '#355f3c']);
    const corners = random.int(9, 12);
    const turn = random.range(0, TAU);
    star(ctx, random, corners, 0.95, 0.62, turn, shade(base, -0.25));
    star(ctx, random, corners, 0.72, 0.45, turn + 0.2, base);
    star(ctx, random, corners, 0.45, 0.27, turn + 0.4, shade(base, 0.15));
    circle(ctx, -0.03, -0.03, 0.1, shade(base, 0.3));
  },
  busch(ctx, random) {
    const base = random.pick(['#4e7d34', '#557f37', '#4a7530']);
    circle(ctx, 0, 0, 0.36, shade(base, -0.3));
    const blobs = random.int(4, 6);
    for (let index = 0; index < blobs; index += 1) {
      const angle = (index / blobs) * TAU + random.range(-0.3, 0.3);
      circle(ctx, Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, random.range(0.17, 0.23), base);
    }
    circle(ctx, -0.08, -0.08, 0.12, shade(base, 0.25));
    if (random.chance(0.3)) {
      for (let index = 0; index < 5; index += 1) {
        circle(ctx, random.range(-0.25, 0.25), random.range(-0.25, 0.25), 0.035, '#b3263a');
      }
    }
  },
  stein(ctx, random) {
    const points = lumpy(random, random.int(6, 8), 0.28, 0.4);
    polygon(ctx, points, '#55514b');
    polygon(
      ctx,
      points.map(([x, y]) => [x * 0.8 - 0.03, y * 0.8 - 0.03]),
      '#96928a',
    );
    polygon(
      ctx,
      points.slice(0, 4).map(([x, y]) => [x * 0.45 - 0.07, y * 0.45 - 0.07]),
      '#b3afa6',
    );
  },
  fels(ctx, random) {
    const points = lumpy(random, random.int(7, 9), 0.7, 0.95);
    polygon(ctx, points, '#46423d');
    polygon(
      ctx,
      points.map(([x, y]) => [x * 0.85 - 0.05, y * 0.85 - 0.05]),
      '#8a857d',
    );
    const facets = random.int(2, 3);
    for (let index = 0; index < facets; index += 1) {
      const angle = random.range(3, 5);
      const cx = Math.cos(angle) * random.range(0.15, 0.4);
      const cy = Math.sin(angle) * random.range(0.15, 0.4);
      polygon(
        ctx,
        lumpy(random, 4, 0.12, 0.28).map(([x, y]) => [x + cx, y + cy]),
        '#a6a197',
      );
    }
    line(
      ctx,
      random.range(-0.4, 0),
      random.range(-0.2, 0.2),
      random.range(0.1, 0.5),
      random.range(0.1, 0.5),
      '#4a4641',
      0.04,
    );
  },
  baumstumpf(ctx, random) {
    for (let index = 0; index < 3; index += 1) {
      const angle = random.range(0, TAU);
      line(ctx, 0, 0, Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, '#4a3220', 0.1);
    }
    circle(ctx, 0, 0, 0.32, '#5b3d22');
    circle(ctx, 0, 0, 0.25, '#c49a62');
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = '#a07a48';
    for (const radius of [0.18, 0.11, 0.05]) {
      ctx.beginPath();
      ctx.arc(0.01, 0.01, radius, 0, TAU);
      ctx.stroke();
    }
    line(ctx, 0, 0, 0.22, -0.08, '#7d5a32', 0.025);
  },
  blumen(ctx, random) {
    for (let index = 0; index < 4; index += 1) {
      const angle = random.range(0, TAU);
      ctx.beginPath();
      ctx.ellipse(Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0.13, 0.05, angle, 0, TAU);
      ctx.fillStyle = '#5f8f3e';
      ctx.fill();
    }
    const color = random.pick(['#e8d34a', '#d9534f', '#f4f1ea', '#9b6bd6', '#e58ac0']);
    const count = random.int(5, 8);
    for (let index = 0; index < count; index += 1) {
      const x = random.range(-0.32, 0.32);
      const y = random.range(-0.32, 0.32);
      circle(ctx, x, y, 0.07, color);
      circle(ctx, x, y, 0.03, '#f5d76e');
    }
  },
  schilf(ctx, random) {
    const stalks = random.int(7, 10);
    for (let index = 0; index < stalks; index += 1) {
      const x = random.range(-0.2, 0.2);
      const y = random.range(-0.1, 0.25);
      const angle = random.range(-2.6, -0.5);
      const length = random.range(0.25, 0.42);
      const tipX = x + Math.cos(angle) * length;
      const tipY = y + Math.sin(angle) * length;
      line(ctx, x, y, tipX, tipY, random.pick(['#8d9a52', '#a3a65f', '#7b8a48']), 0.035);
      if (random.chance(0.4)) {
        ctx.beginPath();
        ctx.ellipse(tipX, tipY, 0.06, 0.03, angle, 0, TAU);
        ctx.fillStyle = '#6b4a2b';
        ctx.fill();
      }
    }
  },
  huette(ctx, random) {
    const thatch = random.pick(['#c9a24f', '#bf9a4a', '#b38d45']);
    rect(ctx, -1.45, -1.35, 2.9, 1.35, shade(thatch, 0.06));
    rect(ctx, -1.45, 0, 2.9, 1.35, shade(thatch, -0.16));
    ctx.beginPath();
    for (let x = -1.38; x < 1.42; x += 0.11) {
      const wobble = random.range(-0.03, 0.03);
      ctx.moveTo(x, -1.3);
      ctx.lineTo(x + wobble, -0.08);
      ctx.moveTo(x, 0.08);
      ctx.lineTo(x + wobble, 1.3);
    }
    ctx.strokeStyle = shade(thatch, -0.25);
    ctx.lineWidth = 0.02;
    ctx.stroke();
    rect(ctx, -1.45, -0.07, 2.9, 0.14, shade(thatch, -0.4));
    ctx.strokeStyle = shade(thatch, -0.45);
    ctx.lineWidth = 0.05;
    ctx.strokeRect(-1.45, -1.35, 2.9, 2.7);
    rect(ctx, -0.28, 1.35, 0.56, 0.15, '#5b3d22');
  },
  haus(ctx, random) {
    const roof = random.pick(['#a5432f', '#8f3b2a', '#6b5b4d', '#56606b']);
    rect(ctx, -1.95, -1.45, 3.9, 1.45, shade(roof, 0.08));
    rect(ctx, -1.95, 0, 3.9, 1.45, shade(roof, -0.14));
    ctx.beginPath();
    for (let row = 1; row < 7; row += 1) {
      const offset = row * 0.2;
      ctx.moveTo(-1.95, -offset);
      ctx.lineTo(1.95, -offset);
      ctx.moveTo(-1.95, offset);
      ctx.lineTo(1.95, offset);
      for (let x = -1.95 + (row % 2) * 0.15; x < 1.95; x += 0.3) {
        ctx.moveTo(x, -offset);
        ctx.lineTo(x, -offset + 0.2);
        ctx.moveTo(x, offset);
        ctx.lineTo(x, offset - 0.2);
      }
    }
    ctx.strokeStyle = shade(roof, -0.3);
    ctx.lineWidth = 0.02;
    ctx.stroke();
    rect(ctx, -1.95, -0.08, 3.9, 0.16, shade(roof, -0.45));
    const chimney = random.chance(0.5) ? 0.85 : -1.2;
    rect(ctx, chimney, -1.05, 0.38, 0.38, '#7d7a73');
    rect(ctx, chimney + 0.08, -0.97, 0.22, 0.22, '#33302d');
    ctx.strokeStyle = shade(roof, -0.5);
    ctx.lineWidth = 0.05;
    ctx.strokeRect(-1.95, -1.45, 3.9, 2.9);
    rect(ctx, -0.3, 1.45, 0.6, 0.15, '#5b3d22');
  },
  turm(ctx) {
    circle(ctx, 0, 0, 1.45, STONE_DARK);
    const merlons = 14;
    ctx.lineWidth = 0.26;
    for (let index = 0; index < merlons; index += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 1.27, (index / merlons) * TAU, ((index + 1) / merlons) * TAU);
      ctx.strokeStyle = index % 2 ? '#a39e95' : '#77736c';
      ctx.stroke();
    }
    circle(ctx, 0, 0, 1.12, '#9c978d');
    ctx.beginPath();
    ctx.arc(0, 0, 0.6, 0, TAU);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * TAU;
      ctx.moveTo(Math.cos(angle) * 0.6, Math.sin(angle) * 0.6);
      ctx.lineTo(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12);
    }
    ctx.strokeStyle = '#7f7a71';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    rect(ctx, -0.22, -0.22, 0.44, 0.44, '#5b3d22');
    line(ctx, -0.22, 0, 0.22, 0, '#3e2a17', 0.03);
  },
  zelt(ctx, random) {
    const cloth = random.pick(['#d8c9a3', '#b9a77a', '#8a9467', '#a8694c', '#6f87a3']);
    ctx.beginPath();
    for (const [x, y] of [
      [-0.8, -0.85],
      [0.8, -0.85],
      [-0.8, 0.85],
      [0.8, 0.85],
    ]) {
      ctx.moveTo(x, y);
      ctx.lineTo(x * 1.2, y * 1.15);
    }
    ctx.strokeStyle = '#5a4a35';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    rect(ctx, -0.8, -0.85, 0.8, 1.7, shade(cloth, 0.1));
    rect(ctx, 0, -0.85, 0.8, 1.7, shade(cloth, -0.15));
    line(ctx, 0, -0.9, 0, 0.9, '#5a4a35', 0.05);
    polygon(
      ctx,
      [
        [-0.35, 0.85],
        [0, 0.42],
        [0.35, 0.85],
      ],
      shade(cloth, -0.5),
    );
    ctx.strokeStyle = shade(cloth, -0.4);
    ctx.lineWidth = 0.03;
    ctx.strokeRect(-0.8, -0.85, 1.6, 1.7);
  },
  mauer(ctx) {
    rect(ctx, -1.5, -0.32, 3, 0.64, '#6f6a62');
    rect(ctx, -1.5, -0.26, 3, 0.52, '#9a958c');
    ctx.beginPath();
    ctx.moveTo(-1.5, 0);
    ctx.lineTo(1.5, 0);
    for (let x = -1.5; x < 1.5; x += 0.4) {
      ctx.moveTo(x, -0.26);
      ctx.lineTo(x, 0);
      ctx.moveTo(x + 0.2, 0);
      ctx.lineTo(x + 0.2, 0.26);
    }
    ctx.strokeStyle = '#6b675f';
    ctx.lineWidth = 0.025;
    ctx.stroke();
  },
  zaun(ctx) {
    rect(ctx, -1.5, -0.08, 3, 0.05, WOOD);
    rect(ctx, -1.5, 0.03, 3, 0.05, WOOD);
    for (const x of [-1.42, -0.47, 0.47, 1.42]) rect(ctx, x - 0.07, -0.11, 0.14, 0.22, WOOD_DARK);
  },
  bruecke(ctx, random) {
    rect(ctx, -2, -0.85, 4, 1.7, '#4a3520');
    for (let x = -2; x < 1.99; x += 0.2) {
      rect(ctx, x + 0.012, -0.8, 0.176, 1.6, random.chance(0.5) ? WOOD : '#7d5e3a');
    }
    rect(ctx, -2, -0.92, 4, 0.14, WOOD_DARK);
    rect(ctx, -2, 0.78, 4, 0.14, WOOD_DARK);
    for (const x of [-1.92, -0.96, 0, 0.96, 1.92]) {
      rect(ctx, x - 0.08, -0.96, 0.16, 0.22, '#3e2c1b');
      rect(ctx, x - 0.08, 0.74, 0.16, 0.22, '#3e2c1b');
    }
  },
  lagerfeuer(ctx, random) {
    const glow = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1.2);
    glow.addColorStop(0, 'rgba(255, 170, 70, 0.45)');
    glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
    circle(ctx, 0, 0, 1.2, glow);
    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * TAU;
      circle(
        ctx,
        Math.cos(angle) * 0.38,
        Math.sin(angle) * 0.38,
        random.range(0.07, 0.1),
        random.pick(['#7d7a73', '#8f8b84', '#6a6660']),
      );
    }
    const turn = random.range(0, Math.PI);
    for (let index = 0; index < 3; index += 1) {
      const angle = turn + (index / 3) * Math.PI;
      line(
        ctx,
        -Math.cos(angle) * 0.27,
        -Math.sin(angle) * 0.27,
        Math.cos(angle) * 0.27,
        Math.sin(angle) * 0.27,
        '#4a3220',
        0.09,
      );
    }
    circle(ctx, 0, 0, 0.2, '#e8661c');
    circle(ctx, 0.02, -0.02, 0.13, '#f6a623');
    circle(ctx, 0.02, -0.03, 0.06, '#ffe27a');
  },
  brunnen(ctx) {
    circle(ctx, 0, 0, 0.88, STONE_DARK);
    circle(ctx, 0, 0, 0.8, STONE);
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * TAU;
      ctx.moveTo(Math.cos(angle) * 0.56, Math.sin(angle) * 0.56);
      ctx.lineTo(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8);
    }
    ctx.strokeStyle = STONE_DARK;
    ctx.lineWidth = 0.03;
    ctx.stroke();
    circle(ctx, 0, 0, 0.56, '#2b5d7c');
    ctx.beginPath();
    ctx.arc(0, 0, 0.4, 3.6, 4.5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 0.04;
    ctx.stroke();
    rect(ctx, -0.98, -0.1, 0.18, 0.2, WOOD_DARK);
    rect(ctx, 0.8, -0.1, 0.18, 0.2, WOOD_DARK);
    rect(ctx, -0.85, -0.05, 1.7, 0.1, '#7d5e3a');
    rect(ctx, -0.25, -0.1, 0.5, 0.2, WOOD);
  },
  kiste(ctx, random) {
    const wood = random.pick(['#a0773f', '#94703e', '#b0864a']);
    rect(ctx, -0.36, -0.36, 0.72, 0.72, shade(wood, -0.35));
    rect(ctx, -0.3, -0.3, 0.6, 0.6, wood);
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.1);
    ctx.lineTo(0.3, -0.1);
    ctx.moveTo(-0.3, 0.1);
    ctx.lineTo(0.3, 0.1);
    ctx.strokeStyle = shade(wood, -0.3);
    ctx.lineWidth = 0.025;
    ctx.stroke();
    line(ctx, -0.28, -0.28, 0.28, 0.28, shade(wood, -0.15), 0.07);
  },
  fass(ctx) {
    circle(ctx, 0, 0, 0.34, '#6b4423');
    circle(ctx, 0, 0, 0.3, '#8b5a2b');
    ctx.beginPath();
    for (const x of [-0.15, 0, 0.15]) {
      const half = Math.sqrt(0.3 * 0.3 - x * x);
      ctx.moveTo(x, -half);
      ctx.lineTo(x, half);
    }
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.lineWidth = 0.04;
    ctx.strokeStyle = '#4a4a48';
    ctx.beginPath();
    ctx.arc(0, 0, 0.3, 0, TAU);
    ctx.stroke();
    circle(ctx, 0.12, 0.08, 0.04, '#3a2412');
  },
  tisch(ctx, random) {
    rect(ctx, -0.92, -0.42, 1.84, 0.84, '#6b4a2b');
    rect(ctx, -0.88, -0.38, 1.76, 0.76, '#9a6b40');
    ctx.beginPath();
    ctx.moveTo(-0.88, -0.13);
    ctx.lineTo(0.88, -0.13);
    ctx.moveTo(-0.88, 0.13);
    ctx.lineTo(0.88, 0.13);
    ctx.strokeStyle = '#7d5532';
    ctx.lineWidth = 0.025;
    ctx.stroke();
    if (random.chance(0.6)) circle(ctx, random.range(-0.6, -0.2), random.range(-0.15, 0.15), 0.13, '#e6e1d6');
    if (random.chance(0.6)) circle(ctx, random.range(0.2, 0.6), random.range(-0.15, 0.15), 0.08, '#c9c2b0');
  },
  karren(ctx, random) {
    rect(ctx, -0.28, -0.52, 0.56, 0.13, '#3a2c1e');
    rect(ctx, -0.28, 0.39, 0.56, 0.13, '#3a2c1e');
    line(ctx, 0.62, -0.25, 1, -0.25, WOOD_DARK, 0.06);
    line(ctx, 0.62, 0.25, 1, 0.25, WOOD_DARK, 0.06);
    rect(ctx, -0.78, -0.42, 1.42, 0.84, '#6b4a2b');
    rect(ctx, -0.72, -0.36, 1.3, 0.72, WOOD);
    const load = random.int(0, 2);
    if (load === 1) {
      polygon(
        ctx,
        lumpy(random, 8, 0.25, 0.34).map(([x, y]) => [x * 1.8 - 0.07, y]),
        '#d8bb5a',
      );
    } else if (load === 2) {
      for (let index = 0; index < 4; index += 1) {
        circle(ctx, -0.45 + index * 0.27, random.range(-0.12, 0.12), 0.15, random.pick(['#cdb98f', '#bfa877']));
      }
    }
  },
};

/** Schatten als einfache Form: ['kreis', Radius] oder ['rechteck', Breite, Höhe]. */
const SHADOWS = {
  laubbaum: ['kreis', 0.9],
  nadelbaum: ['kreis', 0.88],
  busch: ['kreis', 0.34],
  stein: ['kreis', 0.34],
  fels: ['kreis', 0.85],
  baumstumpf: ['kreis', 0.3],
  huette: ['rechteck', 2.9, 2.7],
  haus: ['rechteck', 3.9, 2.9],
  turm: ['kreis', 1.45],
  zelt: ['rechteck', 1.6, 1.7],
  mauer: ['rechteck', 3, 0.64],
  bruecke: ['rechteck', 4, 1.84],
  brunnen: ['kreis', 0.88],
  kiste: ['rechteck', 0.72, 0.72],
  fass: ['kreis', 0.34],
  tisch: ['rechteck', 1.84, 0.84],
  karren: ['rechteck', 1.5, 0.9],
};

/** Ein Objekt an seiner Stelle zeichnen (ctx bereits in Feldern skaliert). */
function paintObject(ctx, object) {
  const definition = objectType(object.type);
  const draw = DRAW[object.type];
  if (!definition || !draw) return;
  const angle = (object.rot * Math.PI) / 180;
  const shadow = SHADOWS[object.type];
  if (shadow) {
    const offset = (definition.layer >= 2 ? 0.22 : 0.09) * object.scale;
    ctx.save();
    ctx.translate(object.x + offset, object.y + offset * 1.2);
    ctx.rotate(angle);
    ctx.scale(object.scale, object.scale);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    if (shadow[0] === 'kreis') ctx.arc(0, 0, shadow[1], 0, TAU);
    else ctx.rect(-shadow[1] / 2, -shadow[2] / 2, shadow[1], shadow[2]);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(object.x, object.y);
  ctx.rotate(angle);
  ctx.scale(object.scale, object.scale);
  draw(ctx, createRandom(object.seed));
  ctx.restore();
}

/** Liegt das Objekt (samt Schatten und Schein) im sichtbaren Ausschnitt? */
function visible(object, view) {
  const definition = objectType(object.type);
  const reach = (Math.max(definition?.w ?? 1, definition?.h ?? 1) * object.scale) / 1.4 + 1.3;
  return (
    object.x + reach >= view.x0 &&
    object.x - reach <= view.x1 &&
    object.y + reach >= view.y0 &&
    object.y - reach <= view.y1
  );
}

/**
 * Alle Objekte in Zeichenreihenfolge.
 * @param {object} [view]  { x0, y0, x1, y1 } in Feldern: nur Objekte in diesem Ausschnitt
 */
export function renderObjects(ctx, scene, cellPx, view = null) {
  ctx.save();
  ctx.scale(cellPx, cellPx);
  ctx.lineCap = 'butt';
  for (const object of drawOrder(scene.objects)) {
    if (!view || visible(object, view)) paintObject(ctx, object);
  }
  ctx.restore();
}

/** Ganze Szene: Gelände und Objekte. */
export function renderScene(ctx, scene, cellPx) {
  renderTerrain(ctx, scene, cellPx);
  renderObjects(ctx, scene, cellPx);
}

/** Bild einer Objektart für die Auswahl im Editor (mittig, passend verkleinert). */
export function drawObjectIcon(ctx, type, sizePx) {
  const definition = objectType(type);
  if (!definition) return;
  const span = Math.max(definition.w, definition.h) + 0.4;
  ctx.save();
  ctx.scale(sizePx / span, sizePx / span);
  paintObject(ctx, { type, x: span / 2, y: span / 2, rot: 0, scale: 1, seed: 3 });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hilfslinien im Editor (nicht im fertigen Bild)
// ---------------------------------------------------------------------------

export function drawGridLines(ctx, cols, rows, cellPx) {
  ctx.save();
  ctx.beginPath();
  for (let x = 0; x <= cols; x += 1) {
    ctx.moveTo(Math.round(x * cellPx) + 0.5, 0);
    ctx.lineTo(Math.round(x * cellPx) + 0.5, rows * cellPx);
  }
  for (let y = 0; y <= rows; y += 1) {
    ctx.moveTo(0, Math.round(y * cellPx) + 0.5);
    ctx.lineTo(cols * cellPx, Math.round(y * cellPx) + 0.5);
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Rahmen um das gewählte Objekt (gestrichelt, in Bildpunkten gleich dick). */
export function drawSelection(ctx, object, cellPx) {
  const definition = objectType(object.type);
  if (!definition) return;
  const w = definition.w * object.scale * cellPx;
  const h = definition.h * object.scale * cellPx;
  ctx.save();
  ctx.translate(object.x * cellPx, object.y * cellPx);
  ctx.rotate((object.rot * Math.PI) / 180);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  ctx.lineDashOffset = 5;
  ctx.strokeStyle = '#1d4ed8';
  ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  ctx.restore();
}

/** Fertiges Kartenbild als Leinwand. */
export function renderSceneCanvas(scene, cellPx) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scene.cols * cellPx);
  canvas.height = Math.round(scene.rows * cellPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Dieser Browser kann keine Bilder zeichnen.');
  renderScene(ctx, scene, cellPx);
  return canvas;
}
