/**
 * zip.js – Liest einzelne Dateien aus einem ZIP-Archiv (z. B. Optolith-Export „.rptok“).
 * Unterstützt unkomprimierte und „deflate“-komprimierte Einträge; entpackt wird mit der
 * eingebauten DecompressionStream des Browsers, ganz ohne Zusatzbibliothek.
 */

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Ist das ein ZIP-Archiv? (Beginnt mit „PK“.) */
export function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function findEndOfDirectory(view) {
  // Der Abschluss steht am Ende, dahinter höchstens ein Kommentar (max. 65535 Bytes).
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  throw new ZipError('Die Datei ist kein gültiges ZIP-Archiv.');
}

/** Inhaltsverzeichnis: Name, Kompression, Größen und Lage jeder Datei. */
export function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const end = findEndOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== DIRECTORY_ENTRY) throw new ZipError('Das ZIP-Archiv ist beschädigt.');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: decoder.decode(new Uint8Array(buffer, offset + 46, nameLength)),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('Dieser Browser kann die Datei nicht entpacken. Bitte einen aktuellen Browser verwenden.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Liefert den Inhalt einer Datei im Archiv (oder null, wenn es sie nicht gibt).
 * @param {ArrayBuffer} buffer  das ganze Archiv
 * @param {string} name          Pfad im Archiv, z. B. „content.xml“
 */
export async function readZipEntry(buffer, name) {
  const entry = listZipEntries(buffer).find((candidate) => candidate.name === name);
  if (!entry) return null;
  const view = new DataView(buffer);
  if (view.getUint32(entry.localOffset, true) !== LOCAL_HEADER) throw new ZipError('Das ZIP-Archiv ist beschädigt.');
  const dataStart =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true);
  const data = new Uint8Array(buffer, dataStart, entry.compressedSize);
  if (entry.method === STORED) return data.slice();
  if (entry.method === DEFLATED) return inflate(data);
  throw new ZipError('Diese Kompression wird nicht unterstützt.');
}
