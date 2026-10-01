/**
 * play-panels.js – Die Seiten des Spielbildschirms (Tab „Karte“) für den geöffneten Helden:
 *  - links „Werte“: LeP, AsP, KaP, Schicksalspunkte und Zustände schnell ändern,
 *  - rechts „Proben“: suchen oder aus der vollständigen Liste antippen – Eigenschaften, Kampf,
 *    alle Talente nach Gruppen, Zauber/Liturgien, Kampftechniken; zuletzt gewürfelte oben.
 * Breit stehen beide rechts am Rand übereinander (Werte oben, Proben darunter), damit die Karte
 * möglichst viel Platz hat; am Handy kommen sie als Schublade von links bzw. rechts.
 * Proben laufen über denselben Probendialog wie im Heldenbogen (inkl. Protokoll).
 */
import { h, icon, ICONS, setChildren } from './dom.js';
import { CONDITIONS, MAX_CONDITION_LEVEL, ROMAN_LEVELS } from '../rules.js';
import { heroName, describeConditions } from '../sheet.js';
import {
  checkChoices,
  checkSections,
  searchChecks,
  recentChoices,
  rememberRecent,
  choicesByKeys,
  specKey,
} from '../check-search.js';
import { readJson, writeJson } from '../storage.js';

/** Zuletzt gewürfelte Proben – je Gerät gemerkt. */
const RECENT_KEY = 'dsa5.karte.proben';
/** Zustände auf- oder zugeklappt – je Gerät gemerkt (sonst: am PC zu, am Handy offen). */
const CONDITIONS_OPEN_KEY = 'dsa5.karte.zustaende-offen';
const WIDE_QUERY = '(min-width: 1000px)';

const POOLS = Object.freeze([
  { key: 'le', label: 'LeP', always: true },
  { key: 'asp', label: 'AsP' },
  { key: 'kap', label: 'KaP' },
  { key: 'schip', label: 'SchiP', always: true },
]);

/** Pools, die der Held hat (AsP/KaP nur mit Maximum). */
export const shownPools = (hero) => POOLS.filter((pool) => pool.always || hero.base[pool.key].max > 0);

/** Kurz für Knöpfe und Kopfzeilen: „LeP 20/30 · AsP 19/20“. */
export function poolSummary(hero) {
  return shownPools(hero)
    .filter(({ key }) => key !== 'schip')
    .map(({ key, label }) => `${label} ${hero.base[key].current}/${hero.base[key].max}`)
    .join(' · ');
}

function stepButton(label, text, onclick, disabled = false) {
  return h('button', { type: 'button', class: 'step-button', 'aria-label': label, onclick, disabled }, text);
}

const isTypingIn = (element) => element.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';

function sideHeader(title, onClose) {
  return h(
    'div',
    { class: 'play-side-head' },
    h('h2', { class: 'play-side-title' }, title),
    h(
      'button',
      { type: 'button', class: 'icon-button play-side-close', 'aria-label': `${title} schließen`, onclick: onClose },
      icon(ICONS.close),
    ),
  );
}

/**
 * Linke Seite: Werte des geöffneten Helden.
 * @param {object} options
 * @param {object} options.store                      Store mit dem geöffneten Helden
 * @param {() => string|null} options.heroId          ID des geöffneten Helden
 * @param {object} options.heroActions                { adjustPool, setPool, setCondition } – mode-room.js
 * @param {() => void} options.onClose                Schublade schließen (Handy)
 */
export function createVitalsPanel({ store, heroId, heroActions, onClose }) {
  const name = h('p', { class: 'play-hero-name' });
  const pools = h('div', { class: 'play-pools' });
  const conditionSummary = h('span', { class: 'play-condition-summary' });
  const conditions = h('div', { class: 'play-condition-list' });
  // Zustände zum Aufklappen: Die Kopfzeile zeigt die aktiven, die Proben darunter behalten Platz.
  const storedOpen = readJson(CONDITIONS_OPEN_KEY, null);
  const conditionBox = h(
    'details',
    {
      class: 'play-conditions',
      open: typeof storedOpen === 'boolean' ? storedOpen : !window.matchMedia?.(WIDE_QUERY).matches,
      ontoggle: (event) => writeJson(CONDITIONS_OPEN_KEY, event.target.open),
    },
    h('summary', {}, h('span', { class: 'play-section-title' }, 'Zustände'), conditionSummary),
    conditions,
  );
  const element = h(
    'aside',
    { class: 'play-side play-side-left', 'aria-label': 'Werte' },
    sideHeader('Werte', onClose),
    name,
    pools,
    conditionBox,
  );
  let renderedKey = '';

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

  function conditionRow(id, hero, condition) {
    const level = hero.conditions[condition.id];
    return h(
      'div',
      { class: `inspector-condition ${level > 0 ? 'is-active' : ''}`.trim() },
      h('span', {}, condition.name),
      stepButton(`${condition.name} −1`, '−', () => heroActions.setCondition(id, condition.id, level - 1), level <= 0),
      h('strong', { class: 'inspector-level' }, ROMAN_LEVELS[level]),
      stepButton(
        `${condition.name} +1`,
        '+',
        () => heroActions.setCondition(id, condition.id, level + 1),
        level >= MAX_CONDITION_LEVEL,
      ),
    );
  }

  function render() {
    const hero = store.hero;
    const id = heroId();
    if (!hero || !id) return;
    const key = JSON.stringify([id, heroName(hero), hero.base, hero.conditions, hero.conditionsOff, hero.autoPain]);
    if (key === renderedKey || isTypingIn(element)) return; // Eingabe nicht unterbrechen
    renderedKey = key;
    name.textContent = heroName(hero);
    setChildren(
      pools,
      shownPools(hero).map((pool) => poolRow(id, hero, pool)),
    );
    conditionSummary.textContent = describeConditions(hero) || 'keine';
    setChildren(
      conditions,
      CONDITIONS.map((condition) => conditionRow(id, hero, condition)),
    );
  }

  // Nach dem Tippen (Feld verlassen) auf den neuesten Stand bringen.
  element.addEventListener('focusout', () =>
    setTimeout(() => {
      renderedKey = '';
      render();
    }),
  );

  return { element, render };
}

/**
 * Rechte Seite: Proben suchen oder aus der vollständigen Liste antippen.
 * @param {object} options
 * @param {object} options.store                       Store mit dem geöffneten Helden
 * @param {(spec: object) => void} options.openCheck   Probendialog öffnen
 * @param {(key: string) => void} options.onToggleFavorite  Probe als Favorit merken/vergessen (im Helden)
 * @param {() => void} options.onClose                 Schublade schließen (Handy)
 */
export function createChecksPanel({ store, openCheck, onToggleFavorite, onClose }) {
  let query = '';
  let recent = readJson(RECENT_KEY, []);
  if (!Array.isArray(recent)) recent = [];
  let renderedKey = '';
  /** Zugeklappte Abschnitte (bleiben zu, solange die Seite offen ist). */
  const collapsed = new Set();

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Probe suchen – Talent, Zauber …',
    'aria-label': 'Probe suchen',
    autocomplete: 'off',
    oninput: (event) => {
      query = event.target.value;
      renderedKey = '';
      render();
    },
  });
  const results = h('div', { class: 'play-checks', 'aria-live': 'polite' });
  const element = h(
    'aside',
    { class: 'play-side play-side-right', 'aria-label': 'Proben' },
    sideHeader('Proben', onClose),
    h('label', { class: 'search' }, icon(ICONS.search), searchInput),
    results,
  );

  function roll(spec) {
    recent = rememberRecent(recent, spec);
    writeJson(RECENT_KEY, recent);
    openCheck(spec);
    renderedKey = '';
    render();
  }

  /** Eine Probe zum Antippen, daneben der Stern: Favorit (z. B. die Angriffe für den Kampf). */
  function choiceRow(choice) {
    const key = specKey(choice.spec);
    const favorite = (store.hero?.favorites ?? []).includes(key);
    return h(
      'div',
      { class: 'play-check-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'play-check',
          'aria-label': `Probe: ${choice.name}`,
          title: choice.sub,
          onclick: () => roll(choice.spec),
        },
        h('span', { class: 'play-check-name' }, choice.name),
        h('span', { class: 'play-check-value' }, choice.value ?? ''),
      ),
      h(
        'button',
        {
          type: 'button',
          class: `play-favorite ${favorite ? 'is-favorite' : ''}`.trim(),
          'aria-label': `${choice.name} als Favorit`,
          'aria-pressed': String(favorite),
          title: favorite ? 'Aus den Favoriten nehmen' : 'Als Favorit merken (steht dann oben und im Kampf)',
          onclick: () => onToggleFavorite(key),
        },
        favorite ? '★' : '☆',
      ),
    );
  }

  function section(id, title, choices) {
    return h(
      'details',
      {
        class: 'play-check-section',
        open: !collapsed.has(id),
        ontoggle: (event) => (event.target.open ? collapsed.delete(id) : collapsed.add(id)),
      },
      h('summary', {}, title, h('span', { class: 'badge' }, String(choices.length))),
      h('div', { class: 'play-check-list' }, choices.map(choiceRow)),
    );
  }

  function render() {
    const hero = store.hero;
    if (!hero) return;
    const key = JSON.stringify([
      query,
      recent,
      hero.attributes,
      hero.talents,
      hero.spells,
      hero.weapons,
      hero.combatTechniques,
      hero.base.aw,
      hero.base.ini,
      hero.favorites,
    ]);
    if (key === renderedKey) return;
    renderedKey = key;
    if (query.trim()) {
      const found = searchChecks(checkChoices(hero), query);
      setChildren(
        results,
        found.length
          ? h('div', { class: 'play-check-list' }, found.map(choiceRow))
          : h('p', { class: 'section-hint' }, 'Keine passende Probe gefunden.'),
      );
      return;
    }
    const all = checkChoices(hero);
    const favorites = choicesByKeys(all, hero.favorites);
    const last = recentChoices(all, recent);
    setChildren(
      results,
      favorites.length
        ? section('favoriten', '★ Favoriten', favorites)
        : h(
            'p',
            { class: 'section-hint' },
            'Tipp: Mit ☆ merkst du dir Proben und Angriffe – sie stehen dann oben und im Kampf.',
          ),
      last.length ? section('zuletzt', 'Zuletzt gewürfelt', last) : null,
      checkSections(hero).map((entry) => section(entry.id, entry.title, entry.choices)),
    );
  }

  return { element, render, focusSearch: () => searchInput.focus({ preventScroll: true }) };
}
