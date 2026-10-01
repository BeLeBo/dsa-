/**
 * play-log.js – Die letzten Würfe direkt auf dem Spielbildschirm (über der Karte), live:
 * wer, was, Ergebnis. Am Handy nur der neueste (aufklappbar), am PC die letzten drei.
 * Es gelten dieselben Sichtbarkeiten wie im Protokoll (verdeckte Würfe sieht nur der Meister).
 */
import { h, setChildren } from './dom.js';
import { describeOutcome } from '../format.js';
import { formatTime } from '../util.js';

/** So viele Würfe zeigt der Streifen aufgeklappt. */
export const RECENT_ROLLS = 5;

/**
 * @param {object} options
 * @param {object} options.log                    Protokoll (room-log.js): entries(), subscribe()
 * @param {() => void} options.onOpenProtocol     zum Tab „Protokoll“
 */
export function createRecentRolls({ log, onOpenProtocol }) {
  let expanded = false;
  let lastId = null;
  const list = h('ol', { class: 'play-log-list', 'aria-live': 'polite' });
  const toggle = h('button', {
    type: 'button',
    class: 'play-log-toggle',
    'aria-expanded': 'false',
    onclick: () => {
      expanded = !expanded;
      render();
    },
  });
  const element = h(
    'section',
    { class: 'play-log', 'aria-label': 'Letzte Würfe' },
    h(
      'div',
      { class: 'play-log-head' },
      h('span', { class: 'play-log-title' }, 'Letzte Würfe'),
      toggle,
      h('button', { type: 'button', class: 'play-log-all', onclick: onOpenProtocol }, 'Protokoll ›'),
    ),
    list,
  );

  function row(record, isNew) {
    const { text, tone } = describeOutcome(record.result);
    return h(
      'li',
      { class: `play-log-row ${isNew ? 'is-new' : ''}`.trim(), dataset: { id: record.id } },
      h('time', { class: 'play-log-time', datetime: record.time }, formatTime(record.time)),
      h('strong', { class: 'play-log-actor' }, record.actor),
      h('span', { class: 'play-log-label' }, record.label),
      h('span', { class: `play-log-outcome tone-${tone}` }, text),
    );
  }

  function render() {
    const entries = log.entries().slice(0, RECENT_ROLLS);
    element.hidden = entries.length === 0;
    element.classList.toggle('is-expanded', expanded);
    toggle.textContent = expanded ? 'weniger ▴' : 'mehr ▾';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.hidden = entries.length < 2;
    const newest = entries[0]?.id ?? null;
    const isNew = newest !== null && lastId !== null && newest !== lastId;
    lastId = newest;
    setChildren(
      list,
      entries.map((record, index) => row(record, isNew && index === 0)),
    );
  }

  log.subscribe(render);
  render();
  return { element, render };
}
