/**
 * sharpen.js – Kanten nachschärfen, bevor ein Kartenausschnitt hochgerechnet wird: Linien, Häuser
 * und Schrift bekommen mehr Kontrast und wirken nach dem Vergrößern deutlich klarer.
 *  - Unschärfemaske auf der Helligkeit – so entstehen keine Farbsäume.
 *  - Überschwingen begrenzt: Ein Punkt wird höchstens wenig heller als sein hellster bzw. dunkler
 *    als sein dunkelster Nachbar. Das verhindert helle Ränder („Halos“) um dunkle Linien.
 * Rein rechnerisch auf RGBA-Daten (wie ImageData.data); Transparenz bleibt unverändert.
 */

/** So viele Helligkeitsstufen darf ein Punkt über seine Nachbarn hinaus geschärft werden. */
export const OVERSHOOT_LIMIT = 8;

/**
 * Schärft RGBA-Daten an Ort und Stelle: Helligkeit minus ihre weichgezeichnete Fassung (3 × 3,
 * Gewichte 1-2-1), verstärkt um `amount`, begrenzt auf die Nachbarschaft ± OVERSHOOT_LIMIT,
 * wird zu Rot, Grün und Blau addiert.
 * @param {Uint8ClampedArray} data  RGBA, width × height × 4
 * @param {number} amount  0 = unverändert, 1 = Kantenkontrast etwa verdoppelt
 * @param {number} [threshold]  kleinere Unterschiede (Rauschen, Papierstruktur) bleiben, wie sie sind
 */
export function unsharpMask(data, width, height, amount, threshold = 2) {
  if (!(amount > 0) || width < 3 || height < 3) return data;
  const count = width * height;
  // Ganzzahlen statt Kommazahlen: wenig Speicher, auch bei großen Ausschnitten am Handy.
  const luma = new Uint8ClampedArray(count);
  for (let index = 0, offset = 0; index < count; index += 1, offset += 4) {
    luma[index] = (77 * data[offset] + 150 * data[offset + 1] + 29 * data[offset + 2]) >> 8;
  }
  // Waagrecht: Summe 1-2-1 (für das Weichzeichnen) sowie kleinster und größter Nachbar.
  // Am Rand zählt der Randpunkt doppelt.
  const across = new Uint16Array(count);
  const lowest = new Uint8Array(count);
  const highest = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = luma[row + (x > 0 ? x - 1 : x)];
      const middle = luma[row + x];
      const right = luma[row + (x < width - 1 ? x + 1 : x)];
      across[row + x] = left + 2 * middle + right;
      lowest[row + x] = Math.min(left, middle, right);
      highest[row + x] = Math.max(left, middle, right);
    }
  }
  // Senkrecht dazu: weichgezeichnet (Summe 16) und die Nachbarschaft 3 × 3.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const above = (y > 0 ? y - 1 : y) * width;
    const below = (y < height - 1 ? y + 1 : y) * width;
    for (let x = 0; x < width; x += 1) {
      const value = luma[row + x];
      const blurred = (across[above + x] + 2 * across[row + x] + across[below + x]) / 16;
      const difference = value - blurred;
      if (difference > -threshold && difference < threshold) continue;
      const floor = Math.min(lowest[above + x], lowest[row + x], lowest[below + x]) - OVERSHOOT_LIMIT;
      const ceiling = Math.max(highest[above + x], highest[row + x], highest[below + x]) + OVERSHOOT_LIMIT;
      const target = Math.min(ceiling, Math.max(floor, value + difference * amount));
      const boost = target - value;
      const offset = (row + x) * 4;
      data[offset] += boost; // Uint8ClampedArray begrenzt auf 0 … 255
      data[offset + 1] += boost;
      data[offset + 2] += boost;
    }
  }
  return data;
}
