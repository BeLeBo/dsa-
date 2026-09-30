/**
 * hero-bar.js – Leiste unter der Karte für den geöffneten Helden: LeP, AsP, KaP und
 * Schicksalspunkte ändern und Proben würfeln (Talente, Eigenschaften, Kampf, Zauber),
 * ohne die Karte zu verlassen. Zugeklappt nur eine Zeile mit Name und LeP/AsP.
 * Proben laufen über denselben Probendialog wie im Heldenbogen (inkl. Protokoll).
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { heroName } from '../sheet.js';
import { checkChoices, quickChoices, searchChecks, recentChoices, rememberRecent } from '../check-search.js';
import { readJson, writeJson } from '../storage.js';

/** Auf- oder zugeklappt – merkt sich das Gerät. */
const OPEN_KEY = 'dsa5.karte.heldenleiste';
/** Zuletzt gewürfelte Proben (Schnellwahl). */
const RECENT_KEY = 'dsa5.karte.proben';

const POOLS = Object.freeze([
  { key: 'le', label: 'LeP', always: true },
  { key: 'asp', label: 'AsP' },
  { key: 'kap', label: 'KaP' },
  { key: 'schip', label: 'SchiP', always: true },
]);

const shownPools = (hero) => POOLS.filter((pool) => pool.always || hero.base[pool.key].max > 0);

function stepButton(label, text, onclick) {
  return h('button', { type: 'button', class: 'step-button', 'aria-label': label, onclick }, text);
}

/**
 * @param {object} options
 * @param {object} options.store          Store mit dem geöffneten Helden
 * @param {() => string|null} options.heroId  ID des geöffneten Helden
 * @param {object} options.heroActions    { adjustPool, setPool } – siehe mode-room.js
 * @param {(spec: object) => void} options.openCheck  Probendialog öffnen
 */
export function createHeroBar({ store, heroId, heroActions, openCheck }) {
  let open = readJson(OPEN_KEY, false) === true;
  let suppressed = false;
  let query = '';
  let recent = readJson(RECENT_KEY, []);
  if (!Array.isArray(recent)) recent = [];
  let poolsKey = '';

  const nameElement = h('strong', { class: 'hero-bar-name' });
  const summary = h('span', { class: 'hero-bar-summary' });
  const toggle = h('button', { type: 'button', class: 'btn btn-small hero-bar-toggle', onclick: () => setOpen(!open) });
  const pools = h('div', { class: 'inspector-pools hero-bar-pools' });
  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Probe suchen – Talent, Zauber …',
    'aria-label': 'Probe suchen',
    autocomplete: 'off',
    oninput: (event) => {
      query = event.target.value;
      renderResults();
    },
  });
  const results = h('div', { class: 'hero-bar-results', 'aria-live': 'polite' });
  const body = h(
    'div',
    { class: 'hero-bar-body' },
    pools,
    h('label', { class: 'search' }, icon(ICONS.search), searchInput),
    results,
  );
  const element = h(
    'section',
    { class: 'map-hero-bar', 'aria-label': 'Held: Werte und Proben' },
    h('div', { class: 'hero-bar-head' }, h('div', { class: 'hero-bar-title' }, nameElement, summary), toggle),
    body,
  );

  function setOpen(value) {
    open = value;
    writeJson(OPEN_KEY, open);
    render(); // kein automatischer Fokus: am Handy ginge sonst die Tastatur auf
  }

  function roll(spec) {
    recent = rememberRecent(recent, spec);
    writeJson(RECENT_KEY, recent);
    openCheck(spec);
    renderResults();
  }

  const choiceButton = (choice, { chip = false } = {}) =>
    h(
      'button',
      {
        type: 'button',
        class: 'hero-bar-choice',
        'aria-label': `Probe: ${choice.name}`,
        onclick: () => roll(choice.spec),
      },
      h('span', { class: 'hero-bar-choice-name' }, chip ? (choice.chip ?? choice.name) : choice.name),
      chip ? null : h('span', { class: 'row-sub' }, choice.sub),
    );

  function renderResults() {
    const hero = store.hero;
    if (!hero || !open) return;
    const choices = checkChoices(hero);
    if (query.trim()) {
      const found = searchChecks(choices, query);
      setChildren(
        results,
        found.length
          ? h(
              'div',
              { class: 'hero-bar-choices is-list' },
              found.map((choice) => choiceButton(choice)),
            )
          : h('p', { class: 'section-hint' }, 'Keine passende Probe gefunden.'),
      );
      return;
    }
    const last = recentChoices(choices, recent);
    setChildren(
      results,
      last.length
        ? [
            h('h3', {}, 'Zuletzt gewürfelt'),
            h(
              'div',
              { class: 'hero-bar-choices' },
              last.map((choice) => choiceButton(choice, { chip: true })),
            ),
          ]
        : null,
      h('h3', {}, 'Eigenschaften und Kampf'),
      h(
        'div',
        { class: 'hero-bar-choices' },
        quickChoices(hero).map((choice) => choiceButton(choice, { chip: true })),
      ),
    );
  }

  function poolRow(id, hero, { key, label }) {
    const pool = hero.base[key];
    return h(
      'div',
      { class: 'inspector-pool' },
      h('span', { class: 'inspector-label' }, label),
      stepButton(`${label} −1`, '−', () => heroActions.adjustPool(id, key, -1)),
      h('input', {
        type: 'number',
        class: 'num',
        inputmode: 'numeric',
        value: String(pool.current),
        'aria-label': `${label} aktuell`,
        onchange: (event) => heroActions.setPool(id, key, event.target.value),
      }),
      stepButton(`${label} +1`, '+', () => heroActions.adjustPool(id, key, 1)),
      h('span', { class: 'inspector-max' }, `/ ${pool.max}`),
    );
  }

  function renderPools(hero, id) {
    const typing = pools.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    const key = JSON.stringify([id, shownPools(hero).map(({ key: pool }) => hero.base[pool])]);
    if (typing || key === poolsKey) return; // Eingabe nicht unterbrechen
    poolsKey = key;
    setChildren(
      pools,
      shownPools(hero).map((pool) => poolRow(id, hero, pool)),
    );
  }

  /** Zeigt den aktuellen Stand (ohne geöffneten Helden oder bei Auswahl des Meisters: ausgeblendet). */
  function render() {
    const hero = store.hero;
    const id = heroId();
    element.hidden = !hero || !id || suppressed;
    if (element.hidden) return;
    nameElement.textContent = heroName(hero);
    setChildren(
      summary,
      shownPools(hero)
        .filter(({ key }) => key !== 'schip')
        .map(({ key, label }) => h('span', {}, `${label} ${hero.base[key].current}/${hero.base[key].max}`)),
    );
    toggle.textContent = open ? 'Einklappen ▾' : 'Probe & Werte ▴';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    element.classList.toggle('is-open', open);
    if (!open) return;
    renderPools(hero, id);
    renderResults();
  }

  // Nach dem Tippen (Feld verlassen) auf den neuesten Stand bringen.
  pools.addEventListener('focusout', () =>
    setTimeout(() => {
      poolsKey = '';
      render();
    }),
  );

  return {
    element,
    render,
    /** Aufklappen (z. B. Tipp auf die eigene Figur). */
    expand: () => {
      if (!open) setOpen(true);
    },
    /** Ausblenden, solange etwas anderes unter der Karte steht (Auswahl des Meisters). */
    setSuppressed(value) {
      if (suppressed === value) return;
      suppressed = value;
      render();
    },
  };
}
