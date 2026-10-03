/**
 * play-log.js – Die letzten Würfe auf dem Spielbildschirm: als Fenster links am Kartenrand über
 * der Karte, mit × wegzuklicken. Zugeklappt bleibt ein kleiner Knopf „Würfe“; ein neuer Wurf springt
 * dann kurz als Hinweis auf (verschwindet von selbst, Antippen öffnet das Fenster).
 * Offen oder zu merkt sich das Gerät (anfangs am PC offen, am Handy zu).
 * Es gelten dieselben Sichtbarkeiten wie im Protokoll (verdeckte Würfe sieht nur der Meister).
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { describeOutcome } from '../format.js';
import { formatTime } from '../util.js';
import { readJson, writeJson } from '../storage.js';

/** So viele Würfe zeigt das Fenster. */
export const RECENT_ROLLS = 8;
/** So lange bleibt der Hinweis auf einen neuen Wurf stehen. */
export const PEEK_MS = 6000;
const OPEN_KEY = 'dsa5.karte.wuerfe-offen';
const WIDE_QUERY = '(min-width: 1000px)';

/** Ein Wurf: wer und wann, darunter was und das Ergebnis. */
function row(record, tag = 'li', isNew = false) {
  const { text, tone } = describeOutcome(record.result);
  return h(
    tag,
    { class: `play-log-row ${isNew ? 'is-new' : ''}`.trim(), dataset: { id: record.id } },
    h(
      'span',
      { class: 'play-log-meta' },
      h('strong', { class: 'play-log-actor' }, record.actor),
      h('time', { class: 'play-log-time', datetime: record.time }, formatTime(record.time)),
    ),
    h(
      'span',
      { class: 'play-log-main' },
      h('span', { class: 'play-log-label' }, record.label),
      h('span', { class: `play-log-outcome tone-${tone}` }, text),
    ),
  );
}

/**
 * @param {object} options
 * @param {object} options.log                    Protokoll (room-log.js): entries(), subscribe()
 * @param {() => void} options.onOpenProtocol     zum Tab „Protokoll“
 */
export function createRecentRolls({ log, onOpenProtocol }) {
  const stored = readJson(OPEN_KEY, null);
  let open = typeof stored === 'boolean' ? stored : Boolean(window.matchMedia?.(WIDE_QUERY).matches);
  let peekTimer = null;
  let newestShown = null;

  const list = h('ol', { class: 'play-log-list', 'aria-live': 'polite' });
  const openButton = h(
    'button',
    {
      type: 'button',
      class: 'play-log-open',
      'aria-expanded': 'false',
      'aria-label': 'Letzte Würfe zeigen',
      onclick: () => setOpen(true),
    },
    icon(ICONS.log),
    h('span', {}, 'Würfe'),
  );
  const panel = h(
    'div',
    { class: 'play-log-panel' },
    h(
      'div',
      { class: 'play-log-head' },
      h('span', { class: 'play-log-title' }, 'Letzte Würfe'),
      h('button', { type: 'button', class: 'play-log-all', onclick: onOpenProtocol }, 'Protokoll ›'),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button play-log-close',
          'aria-label': 'Letzte Würfe schließen',
          onclick: () => setOpen(false),
        },
        icon(ICONS.close),
      ),
    ),
    list,
  );
  const peekBody = h('button', {
    type: 'button',
    class: 'play-log-peek-open',
    'aria-label': 'Neuer Wurf – alle letzten Würfe zeigen',
    onclick: () => setOpen(true),
  });
  const peek = h(
    'div',
    { class: 'play-log-peek', role: 'status', hidden: true },
    peekBody,
    h(
      'button',
      { type: 'button', class: 'icon-button play-log-close', 'aria-label': 'Hinweis schließen', onclick: hidePeek },
      icon(ICONS.close),
    ),
  );
  const element = h('section', { class: 'play-log', 'aria-label': 'Letzte Würfe' }, openButton, peek, panel);

  function hidePeek() {
    clearTimeout(peekTimer);
    peek.hidden = true;
  }

  function showPeek(record) {
    setChildren(peekBody, row(record, 'span', true));
    peek.hidden = false;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(hidePeek, PEEK_MS);
  }

  function setOpen(value) {
    open = value;
    writeJson(OPEN_KEY, open);
    if (open) hidePeek();
    render();
  }

  function render() {
    const entries = log.entries().slice(0, RECENT_ROLLS);
    element.hidden = entries.length === 0;
    element.classList.toggle('is-open', open);
    panel.hidden = !open;
    openButton.hidden = open;
    openButton.setAttribute('aria-expanded', String(open));
    const newest = entries[0]?.id ?? null;
    const isNew = newest !== null && newestShown !== null && newest !== newestShown;
    newestShown = newest;
    setChildren(
      list,
      entries.map((record, index) => row(record, 'li', isNew && index === 0)),
    );
  }

  log.subscribe((entries, change) => {
    render();
    // Neuer Wurf (nicht beim Laden), den man sehen darf: bei zugeklapptem Fenster kurz aufspringen.
    const added = change?.added;
    if (!open && added && log.entries().some((record) => record.id === added.id)) showPeek(added);
  });
  render();
  return { element, render };
}
