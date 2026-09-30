/**
 * app.js – Einstieg: lädt den Helden, baut Kopfzeile, Tabs und Ansichten auf
 * und speichert Änderungen (mit Verzögerung) im Browser.
 */
import { h, icon, setChildren, ICONS } from './ui/dom.js';
import { showError } from './ui/toast.js';
import { applyTheme } from './ui/theme.js';
import { openMenu } from './ui/menu.js';
import { openCheckDialog } from './ui/check-dialog.js';
import { createSheetView } from './ui/sheet/view.js';
import { createDiceView } from './ui/dice-view.js';
import { createLogView } from './ui/log-view.js';
import { createHeroStore } from './store.js';
import { createSaver } from './saver.js';
import { createLocalLog } from './log.js';
import { readJson, writeJson } from './storage.js';
import { normalizeHero, heroName, conditionState } from './sheet.js';
import { formatModifier } from './format.js';

const HERO_KEY = 'dsa5.lokalerHeld';
const LOG_KEY = 'dsa5.protokoll';
const TAB_KEY = 'dsa5.ui.tab';

const TABS = [
  { id: 'held', name: 'Held', icon: ICONS.hero },
  { id: 'wuerfeln', name: 'Würfeln', icon: ICONS.dice },
  { id: 'protokoll', name: 'Protokoll', icon: ICONS.log },
];

const SAVE_STATUS_TEXT = {
  saving: 'wird gespeichert …',
  saved: 'gespeichert',
  offline: 'offline',
  error: 'Speichern fehlgeschlagen',
};

// ---------------------------------------------------------------------------
// Fehler nie still verschlucken
// ---------------------------------------------------------------------------

window.addEventListener('error', (event) => showError(event.error ?? event.message, 'Unerwarteter Fehler'));
window.addEventListener('unhandledrejection', (event) => showError(event.reason, 'Unerwarteter Fehler'));

// ---------------------------------------------------------------------------
// Kopfzeile
// ---------------------------------------------------------------------------

function createHeader(store) {
  const title = h('h1', { class: 'app-title' });
  const status = h('span', { class: 'save-status', dataset: { status: 'saved' } }, SAVE_STATUS_TEXT.saved);
  const vitals = h('div', { class: 'vitals', 'aria-label': 'Aktuelle Werte' });
  const menuButton = h(
    'button',
    { type: 'button', class: 'icon-button', 'aria-label': 'Menü öffnen', onclick: () => openMenu({ store }) },
    icon(ICONS.menu),
  );

  function vital(label, pool) {
    return h('span', { class: 'vital' }, h('small', {}, label), `${pool.current}/${pool.max}`);
  }

  function refresh() {
    const hero = store.hero;
    title.textContent = heroName(hero);
    document.title = `${heroName(hero)} – DSA5`;
    const { penalty } = conditionState(hero);
    setChildren(
      vitals,
      vital('LE', hero.base.le),
      hero.base.asp.max > 0 ? vital('AsP', hero.base.asp) : null,
      hero.base.kap.max > 0 ? vital('KaP', hero.base.kap) : null,
      vital('SchiP', hero.base.schip),
      penalty ? h('span', { class: 'vital vital-warn' }, h('small', {}, 'Zustände'), formatModifier(penalty)) : null,
    );
  }

  function setStatus(state) {
    status.dataset.status = state;
    status.textContent = SAVE_STATUS_TEXT[state];
  }

  const element = h(
    'header',
    { class: 'app-header' },
    h('div', { class: 'app-header-main' }, h('div', { class: 'app-heading' }, title, status), menuButton),
    vitals,
  );
  store.subscribe(refresh);
  refresh();
  return { element, setStatus };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function createTabs(panels) {
  const buttons = new Map();

  function select(id) {
    for (const tab of TABS) {
      const active = tab.id === id;
      panels.get(tab.id).hidden = !active;
      buttons.get(tab.id).setAttribute('aria-selected', String(active));
    }
    writeJson(TAB_KEY, id);
    window.scrollTo(0, 0);
  }

  const bar = h(
    'nav',
    { class: 'tab-bar', role: 'tablist', 'aria-label': 'Bereiche' },
    TABS.map((tab) => {
      const button = h(
        'button',
        { type: 'button', role: 'tab', 'aria-controls': `tab-${tab.id}`, onclick: () => select(tab.id) },
        icon(tab.icon),
        h('span', {}, tab.name),
      );
      buttons.set(tab.id, button);
      return button;
    }),
  );

  const stored = readJson(TAB_KEY, TABS[0].id);
  select(TABS.some((tab) => tab.id === stored) ? stored : TABS[0].id);
  return bar;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function start() {
  applyTheme();
  const store = createHeroStore(normalizeHero(readJson(HERO_KEY, null)));
  const log = createLocalLog(LOG_KEY);
  const header = createHeader(store);

  const saver = createSaver({
    save: () => {
      if (!writeJson(HERO_KEY, store.hero)) {
        throw new Error(
          'Der Browser erlaubt kein Speichern (privater Modus oder Speicher voll). Bitte den Helden exportieren.',
        );
      }
    },
    onStatus: (state, error) => {
      header.setStatus(state);
      if (error) showError(error, 'Speichern fehlgeschlagen');
    },
  });
  store.subscribe(() => saver.schedule());

  // Beim Verlassen oder Wechseln der App sofort speichern statt auf die Verzögerung zu warten.
  window.addEventListener('pagehide', () => saver.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flush();
  });

  const panels = new Map(
    TABS.map((tab) => [tab.id, h('section', { id: `tab-${tab.id}`, class: 'tab-panel', role: 'tabpanel' })]),
  );
  const openCheck = (spec) => {
    try {
      openCheckDialog({ store, log }, spec);
    } catch (error) {
      showError(error, 'Probe nicht möglich');
    }
  };

  const sheetRoot = h('div', { class: 'sheet' });
  panels.get('held').append(sheetRoot);
  createSheetView(sheetRoot, store, { openCheck });
  createDiceView(panels.get('wuerfeln'), { store, log, openCheck });
  createLogView(panels.get('protokoll'), log);

  const app = document.getElementById('app');
  setChildren(app, header.element, h('main', { class: 'app-main' }, [...panels.values()]), createTabs(panels));
}

try {
  start();
} catch (error) {
  showError(error, 'Die App konnte nicht gestartet werden');
}
