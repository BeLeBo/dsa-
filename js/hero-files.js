/**
 * hero-files.js – Liest ausgewählte Helden-Dateien und erkennt ihre Art:
 *  - eigene Sicherung (.json aus „Held exportieren“),
 *  - Optolith-MapTool-Token (.rptok, ein ZIP-Archiv mit content.xml),
 *  - Optolith-Heldendatei (.json).
 * Die beiden Optolith-Dateien eines Helden lassen sich zusammen wählen – das ergibt den
 * vollständigsten Helden (siehe optolith.js).
 */
import { importHero, HeroImportError } from './sheet.js';
import { heroFromOptolith, isOptolithJson, isOptolithToken, parseMapToolToken, nameKey } from './optolith.js';
import { isZip, readZipEntry } from './zip.js';

const PDF_SIGNATURE = '%PDF';

async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZip(bytes)) {
    const content = await readZipEntry(bytes.buffer, 'content.xml').catch(() => null);
    const token = content ? parseMapToolToken(new TextDecoder().decode(content)) : null;
    if (!token || !isOptolithToken(token)) {
      throw new HeroImportError(`„${file.name}“ ist kein Held aus Optolith (MapTool-Export).`);
    }
    return { kind: 'token', token };
  }
  const text = new TextDecoder().decode(bytes);
  if (text.startsWith(PDF_SIGNATURE)) {
    throw new HeroImportError(
      'Einen PDF-Heldenbogen kann die App nicht einlesen. Bitte in Optolith den MapTool-Export (.rptok) und/oder die Heldendatei (.json) wählen.',
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HeroImportError(`„${file.name}“ ist weder eine Helden-Sicherung noch ein Export aus Optolith.`);
  }
  return isOptolithJson(data) ? { kind: 'optolith', json: data } : { kind: 'backup', text };
}

/**
 * Liest die gewählten Dateien und baut daraus einen Helden.
 * @param {FileList|File[]} files
 * @returns {Promise<{ hero: object, report: { imported: string[], todo: string[] } | null }>}
 *          `report` gibt es nur beim Import aus Optolith.
 */
export async function readHeroFiles(files) {
  const read = await Promise.all([...files].map(readFile));
  if (read.length === 0) throw new HeroImportError('Keine Datei gewählt.');

  const backups = read.filter((file) => file.kind === 'backup');
  if (backups.length > 0) {
    if (read.length > 1) throw new HeroImportError('Bitte nur eine Sicherungsdatei auswählen.');
    return { hero: importHero(backups[0].text), report: null };
  }

  const tokens = read.filter((file) => file.kind === 'token');
  const jsons = read.filter((file) => file.kind === 'optolith');
  if (tokens.length > 1 || jsons.length > 1) {
    throw new HeroImportError('Bitte nur die Dateien eines Helden wählen (höchstens eine .rptok und eine .json).');
  }
  const token = tokens[0]?.token ?? null;
  const json = jsons[0]?.json ?? null;
  if (token && json && token.name && nameKey(token.name) !== nameKey(json.name)) {
    throw new HeroImportError(`Die Dateien gehören zu verschiedenen Helden („${token.name}“ und „${json.name}“).`);
  }
  return heroFromOptolith({ json, token });
}
