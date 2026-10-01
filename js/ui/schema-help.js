/**
 * schema-help.js – Hilfe, wenn die Datenbank in Supabase älter ist als die App: Schritt für
 * Schritt das Skript supabase/schema.sql erneut ausführen (kopieren, SQL Editor, Run).
 * Und umgekehrt (App älter als die Datenbank): Seite neu laden.
 */
import { h, setChildren } from './dom.js';
import { openDialog } from './dialog.js';
import { showToast } from './toast.js';
import { sqlEditorUrl } from '../supabase.js';

/** Das Skript liegt mit der App auf GitHub Pages – so ist es immer die passende Fassung. */
const SCHEMA_URL = './supabase/schema.sql';

async function loadSchemaText() {
  const response = await fetch(SCHEMA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Das Skript konnte nicht geladen werden (${response.status}).`);
  return response.text();
}

/** Zeigt die Anleitung (Knopf „So geht’s“ an der Fehlermeldung). */
export function openSchemaHelp() {
  const dialog = openDialog({ title: 'Datenbank aktualisieren' });
  const copyArea = h('div', { class: 'schema-copy' });

  async function copy() {
    try {
      const text = await loadSchemaText();
      try {
        await navigator.clipboard.writeText(text);
        showToast('Skript kopiert – jetzt im SQL Editor einfügen.');
        setChildren(copyArea, h('p', { class: 'section-hint' }, `✓ Kopiert (${text.split('\n').length} Zeilen).`));
      } catch {
        // Kein Zugriff auf die Zwischenablage: Text zum Selbstkopieren anzeigen.
        const area = h('textarea', { class: 'schema-text', readonly: true, rows: 6, 'aria-label': 'SQL-Skript' }, text);
        setChildren(copyArea, h('p', { class: 'section-hint' }, 'Bitte alles markieren und kopieren:'), area);
        area.focus();
        area.select();
      }
    } catch (error) {
      showToast(error.message, { tone: 'error' });
    }
  }

  const step = (number, ...content) =>
    h(
      'li',
      { class: 'schema-step' },
      h('span', { class: 'schema-step-number' }, String(number)),
      h('div', {}, ...content),
    );

  setChildren(
    dialog.body,
    h(
      'p',
      {},
      'Die App ist neuer als eure Datenbank in Supabase. Einmal das Skript ausführen – Räume, Helden und Karten bleiben erhalten. Das macht, wer das Supabase-Projekt eingerichtet hat.',
    ),
    h(
      'ol',
      { class: 'schema-steps' },
      step(
        1,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: copy }, 'SQL-Skript kopieren'),
        copyArea,
      ),
      step(
        2,
        h('a', { class: 'btn', href: sqlEditorUrl(), target: '_blank', rel: 'noopener' }, 'Supabase SQL Editor öffnen'),
        h('p', { class: 'section-hint' }, 'Ggf. anmelden. Es öffnet sich eine neue, leere Abfrage („New query“).'),
      ),
      step(
        3,
        h(
          'p',
          {},
          'Ins Textfeld einfügen (Strg+V, am Handy lange tippen → Einfügen) und unten rechts auf „Run“ klicken. ',
          'Es erscheint „Success. No rows returned“.',
        ),
      ),
      step(4, h('p', {}, 'Hier die Seite neu laden – fertig.')),
    ),
  );
  setChildren(
    dialog.footer,
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Schließen'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.location.reload() }, 'Neu laden'),
  );
}

/** Meldet einen Unterschied zwischen App und Datenbank (beim Start) – mit passender Aktion. */
export function showSchemaProblem(problem) {
  if (problem?.appOutdated) {
    showToast(problem.message, {
      tone: 'error',
      duration: 60000,
      action: { label: 'Neu laden', onClick: () => window.location.reload() },
    });
  } else if (problem?.schema) {
    showToast(problem.message, {
      tone: 'error',
      duration: 60000,
      action: { label: 'So geht’s', onClick: openSchemaHelp },
    });
  }
}
