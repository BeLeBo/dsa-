/**
 * flood-fill.js – Farbeimer: die zusammenhängende Fläche gleicher Farbe um einen Punkt finden
 * und ihren Umriss als Punktliste liefern. Rein rechnerisch auf RGBA-Daten (wie ImageData.data).
 *
 *  1. Fläche füllen (zeilenweise, Farbabstand bis zur Toleranz),
 *  2. um einen Bildpunkt erweitern – so schließt die Füllung ohne Spalt an kantengeglättete Linien an,
 *  3. äußeren Rand nachfahren, dazu die Ränder größerer Löcher (wie in Paint: eine Insel in der
 *     Fläche bleibt frei; winzige Sprenkel, z. B. Papierstruktur, werden mitgefüllt),
 *  4. Umrisse vereinfachen (Douglas-Peucker), damit die gespeicherte Form klein bleibt.
 */

/** Wie stark darf die Farbe in der Fläche schwanken (je Farbkanal, 0 … 255)? */
export const BUCKET_TOLERANCE = 48;
/** Löcher ab dieser Größe (Bildpunkte) bleiben frei; höchstens so viele (die größten). */
export const MIN_HOLE_PIXELS = 30;
export const MAX_HOLES = 40;

/**
 * Fläche um den Startpunkt, deren Farbe höchstens `tolerance` (je Kanal) von der des Startpunkts
 * abweicht – waagrecht und senkrecht zusammenhängend.
 * @returns {Uint8Array|null}  1 = gehört zur Fläche; null, wenn der Punkt außerhalb liegt
 */
export function floodFill(rgba, width, height, startX, startY, tolerance = BUCKET_TOLERANCE) {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const mask = new Uint8Array(width * height);
  const seed = (sy * width + sx) * 4;
  const red = rgba[seed];
  const green = rgba[seed + 1];
  const blue = rgba[seed + 2];
  const matches = (index) => {
    const offset = index * 4;
    return (
      Math.abs(rgba[offset] - red) <= tolerance &&
      Math.abs(rgba[offset + 1] - green) <= tolerance &&
      Math.abs(rgba[offset + 2] - blue) <= tolerance
    );
  };
  const stack = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    const row = y * width;
    if (mask[row + x]) continue;
    let left = x;
    while (left > 0 && !mask[row + left - 1] && matches(row + left - 1)) left -= 1;
    let right = x;
    while (right < width - 1 && !mask[row + right + 1] && matches(row + right + 1)) right += 1;
    for (let index = left; index <= right; index += 1) mask[row + index] = 1;
    for (const next of [y - 1, y + 1]) {
      if (next < 0 || next >= height) continue;
      const nextRow = next * width;
      let open = false;
      for (let index = left; index <= right; index += 1) {
        const fits = !mask[nextRow + index] && matches(nextRow + index);
        if (fits && !open) stack.push(index, next);
        open = fits;
      }
    }
  }
  return mask;
}

/** Fläche um einen Bildpunkt erweitern (auch schräg). */
export function dilate(mask, width, height) {
  const grown = new Uint8Array(mask);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx >= 0 && nx < width) grown[ny * width + nx] = 1;
        }
      }
    }
  }
  return grown;
}

// Nachbarn im Uhrzeigersinn (y zeigt nach unten): W, NW, N, NO, O, SO, S, SW
const DIRECTIONS = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

/**
 * Äußerer Rand einer zusammenhängenden Fläche (Moore-Nachbarschaft) als Mittelpunkte der
 * Randpunkte, im Uhrzeigersinn. Begonnen wird beim ersten Punkt der Fläche (oben links) – der
 * liegt sicher auf dem äußeren Rand, nicht am Rand eines Lochs.
 * @returns {{x, y}[]}
 */
export function traceOutline(mask, width, height) {
  const first = mask.indexOf(1);
  if (first < 0) return [];
  const start = { x: first % width, y: Math.floor(first / width) };
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const outline = [{ x: start.x + 0.5, y: start.y + 0.5 }];
  let x = start.x;
  let y = start.y;
  let back = 0; // der westliche Nachbar des Startpunkts liegt außerhalb
  let firstMove = -1;
  const limit = 4 * width * height + 8;
  for (let step = 0; step < limit; step += 1) {
    let found = -1;
    for (let turn = 1; turn <= 8; turn += 1) {
      const direction = (back + turn) % 8;
      if (inside(x + DIRECTIONS[direction][0], y + DIRECTIONS[direction][1])) {
        found = direction;
        break;
      }
    }
    if (found < 0) break; // einzelner Punkt
    if (x === start.x && y === start.y) {
      if (firstMove === found) break; // Runde geschlossen
      if (firstMove < 0) firstMove = found;
    }
    x += DIRECTIONS[found][0];
    y += DIRECTIONS[found][1];
    back = (found + 5) % 8; // als Nächstes von links her weitersuchen
    if (!(x === start.x && y === start.y)) outline.push({ x: x + 0.5, y: y + 0.5 });
  }
  return outline;
}

function perpendicular(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
}

function simplifyChain(points, epsilon) {
  if (points.length <= 2) return points;
  let farthest = 0;
  let index = 0;
  for (let position = 1; position < points.length - 1; position += 1) {
    const distance = perpendicular(points[position], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = position;
    }
  }
  if (farthest <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplifyChain(points.slice(0, index + 1), epsilon);
  const right = simplifyChain(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Geschlossenen Umriss vereinfachen: Punkte, die höchstens `epsilon` neben der Strecke liegen, fallen weg. */
export function simplifyRing(points, epsilon) {
  if (points.length <= 3) return points;
  // Bei dem Punkt teilen, der am weitesten vom ersten entfernt ist – dann zwei offene Ketten.
  let split = 0;
  let farthest = -1;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - points[0].x, point.y - points[0].y);
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  });
  const first = simplifyChain(points.slice(0, split + 1), epsilon);
  const second = simplifyChain([...points.slice(split), points[0]], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/**
 * Löcher einer Fläche: Bereiche außerhalb der Fläche, die vom Bildrand aus nicht erreichbar sind.
 * Je Loch die Größe und ein eigener Ausschnitt zum Nachfahren des Randes.
 * @returns {{ area, x, y, width, height, mask }[]}  die größten zuerst
 */
export function findHoles(mask, width, height, minPixels = MIN_HOLE_PIXELS) {
  const count = width * height;
  const labels = new Int32Array(count); // 0 = noch offen, -1 = außen, > 0 = Loch Nr.
  const spread = (startIndex, label) => {
    const stack = [startIndex];
    const box = { area: 0, x0: width, y0: height, x1: 0, y1: 0 };
    labels[startIndex] = label;
    while (stack.length > 0) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      box.area += 1;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
        if (next < 0 || next >= count || mask[next] || labels[next] !== 0) continue;
        labels[next] = label;
        stack.push(next);
      }
    }
    return box;
  };
  // Alles, was vom Rand aus erreichbar ist, liegt außerhalb.
  for (let x = 0; x < width; x += 1) {
    for (const index of [x, (height - 1) * width + x]) {
      if (!mask[index] && labels[index] === 0) spread(index, -1);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (const index of [y * width, y * width + width - 1]) {
      if (!mask[index] && labels[index] === 0) spread(index, -1);
    }
  }
  const holes = [];
  let label = 0;
  for (let index = 0; index < count; index += 1) {
    if (mask[index] || labels[index] !== 0) continue;
    label += 1;
    const box = spread(index, label);
    if (box.area < minPixels) continue;
    // Eigener Ausschnitt mit einem Punkt Rand, damit das Nachfahren nicht am Ausschnitt endet.
    const holeWidth = box.x1 - box.x0 + 3;
    const holeHeight = box.y1 - box.y0 + 3;
    const holeMask = new Uint8Array(holeWidth * holeHeight);
    for (let y = box.y0; y <= box.y1; y += 1) {
      for (let x = box.x0; x <= box.x1; x += 1) {
        if (labels[y * width + x] === label) holeMask[(y - box.y0 + 1) * holeWidth + (x - box.x0 + 1)] = 1;
      }
    }
    holes.push({ area: box.area, x: box.x0 - 1, y: box.y0 - 1, width: holeWidth, height: holeHeight, mask: holeMask });
  }
  return holes.sort((a, b) => b.area - a.area);
}

/** Reicht die Fläche bis an den Bildrand (ist also nicht rundum eingeschlossen)? */
export function touchesBorder(mask, width, height) {
  for (let x = 0; x < width; x += 1) {
    if (mask[x] || mask[(height - 1) * width + x]) return true;
  }
  for (let y = 0; y < height; y += 1) {
    if (mask[y * width] || mask[y * width + width - 1]) return true;
  }
  return false;
}

/**
 * Farbeimer auf einem Bild: Umrisse der Fläche um den Startpunkt in Bildpunkten – zuerst der
 * äußere, dann die Ränder größerer Löcher (gefüllt wird nach der Gerade-ungerade-Regel).
 * Zusammen höchstens `maxPoints` Punkte. null, wenn die Fläche zu klein ist – oder, mit
 * `enclosed`, wenn sie nicht rundum eingeschlossen ist (bis an den Bildrand reicht).
 * @returns {{x, y}[][] | null}
 */
export function bucketOutline(
  rgba,
  width,
  height,
  startX,
  startY,
  { tolerance = BUCKET_TOLERANCE, maxPoints = 1500, enclosed = false } = {},
) {
  const filled = floodFill(rgba, width, height, startX, startY, tolerance);
  if (!filled) return null;
  if (enclosed && touchesBorder(filled, width, height)) return null;
  let area = 0;
  for (const value of filled) area += value;
  if (area < 9) return null;
  const grown = dilate(filled, width, height);
  const outer = traceOutline(grown, width, height);
  if (outer.length < 3) return null;
  const holes = findHoles(grown, width, height)
    .slice(0, MAX_HOLES)
    .map((hole) =>
      traceOutline(hole.mask, hole.width, hole.height).map((point) => ({ x: point.x + hole.x, y: point.y + hole.y })),
    )
    .filter((ring) => ring.length >= 3);
  const rings = [outer, ...holes];
  let epsilon = 0.75;
  const simplify = () => rings.map((ring) => simplifyRing(ring, epsilon)).filter((ring) => ring.length >= 3);
  let simplified = simplify();
  // Trennzeichen zwischen den Umrissen zählen mit (siehe flattenRings in map.js).
  const total = (list) => list.reduce((sum, ring) => sum + ring.length + 1, -1);
  while (total(simplified) > maxPoints && epsilon < 64) {
    epsilon *= 1.6;
    simplified = simplify();
  }
  while (total(simplified) > maxPoints && simplified.length > 1) simplified.pop(); // kleinste Löcher weglassen
  return simplified.length > 0 && simplified[0].length >= 3 ? simplified : null;
}
