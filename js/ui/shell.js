/**
 * shell.js – Rahmen der App: Kopfzeile (Held, Speicherstatus, Werte), Tabs unten
 * und die Ansichten Held, Würfeln, Protokoll (optional Gruppe).
 * Wird vom Modus „Ohne Raum“ und vom Raum-Modus gleichermaßen genutzt.
 */
import { h, icon, setChildren, ICONS } from './dom.js';
import { showError } from './toast.js';
import { openMenu } from './menu.js';
import { openCheckDialog } from './check-dialog.js';
import { createSheetView } from './sheet/view.js';
import { createDiceView } from './dice-view.js';
import { createLogView } from './log-view.js';
import { readJson, writeJson } from '../storage.js';
import { heroName, conditionState } from '../sheet.js';
import { formatModifier } from '../format.js';

const TAB_KEY = 'dsa5.ui.tab';

export const TABS = Object.freeze({
  hero: { id: 'held', name: 'Held', icon: ICONS.hero },
  dice: { id: 'wuerfeln', name: 'Würfeln', icon: ICONS.dice },
  log: { id: 'protokoll', name: 'Protokoll', icon: ICONS.log },
  group: { id: 'gruppe', name: 'Gruppe', icon: ICONS.group },
});

const STATUS_TEXT = {
  connecting: 'verbinde …',
  online: 'verbunden',
  saving: 'wird gespeichert …',
  saved: 'gespeichert',
  offline: 'offline – wird später übertragen',
  error: 'Speichern fehlgeschlagen',
};

function createHeader(store, { title, subtitle, menu }) {
  const titleElement = h('h1', { class: 'app-title' });
  const subtitleElement = h('p', { class: 'app-subtitle' });
  const status = h('span', { class: 'save-status', dataset: { status: 'saved' } }, STATUS_TEXT.saved);
  const vitals = h('div', { class: 'vitals', 'aria-label': 'Aktuelle Werte' });
  const menuButton = h(
    'button',
    { type: 'button', class: 'icon-button', 'aria-label': 'Menü öffnen', onclick: () => openMenu(menu()) },
    icon(ICONS.menu),
  );

  function vital(label, pool) {
    return h('span', { class: 'vital' }, h('small', {}, label), `${pool.current}/${pool.max}`);
  }

  function refresh() {
    const hero = store.hero;
    const text = hero ? heroName(hero) : title();
    titleElement.textContent = text;
    document.title = `${text} – DSA5`;
    const sub = subtitle();
    subtitleElement.textContent = sub ?? '';
    subtitleElement.hidden = !sub;
    if (!hero) {
      setChildren(vitals);
      return;
    }
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
    status.textContent = STATUS_TEXT[state] ?? state;
  }

  const element = h(
    'header',
    { class: 'app-header' },
    h(
      'div',
      { class: 'app-header-main' },
      h('div', { class: 'app-heading' }, titleElement, subtitleElement, status),
      menuButton,
    ),
    vitals,
  );
  store.subscribe(refresh);
  refresh();
  return { element, setStatus, refresh };
}

function createTabBar(tabs, panels) {
  const buttons = new Map();

  function select(id) {
    const target = tabs.some((tab) => tab.id === id) ? id : tabs[0].id;
    for (const tab of tabs) {
      const active = tab.id === target;
      panels.get(tab.id).hidden = !active;
      buttons.get(tab.id).setAttribute('aria-selected', String(active));
    }
    writeJson(TAB_KEY, target);
    window.scrollTo(0, 0);
  }

  const element = h(
    'nav',
    { class: 'tab-bar', role: 'tablist', 'aria-label': 'Bereiche' },
    tabs.map((tab) => {
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
  select(readJson(TAB_KEY, tabs[0].id));
  return { element, select };
}

/**
 * Baut die App-Oberfläche auf.
 * @param {object} options
 * @param {object} options.store          Heldenspeicher
 * @param {object} options.log            Würfelprotokoll
 * @param {object[]} options.tabs         Liste aus TABS
 * @param {() => string} options.title    Titel, wenn kein Held geöffnet ist
 * @param {() => string|null} options.subtitle  z. B. Raum und Rolle
 * @param {() => string} options.actorName     Name für freie Würfe
 * @param {() => Node} options.renderEmptyHero Inhalt des Held-Tabs ohne Held
 * @param {() => object} options.menu     Menüeinträge (siehe menu.js)
 */
export function createShell({ store, log, tabs, title, subtitle = () => null, actorName, renderEmptyHero, menu }) {
  const header = createHeader(store, { title, subtitle, menu });
  const panels = new Map(
    tabs.map((tab) => [tab.id, h('section', { id: `tab-${tab.id}`, class: 'tab-panel', role: 'tabpanel' })]),
  );

  const openCheck = (spec) => {
    try {
      openCheckDialog({ store, log }, spec);
    } catch (error) {
      showError(error, 'Probe nicht möglich');
    }
  };

  const sheetRoot = h('div', { class: 'sheet' });
  panels.get(TABS.hero.id).append(sheetRoot);
  const sheet = createSheetView(sheetRoot, store, { openCheck, renderEmpty: renderEmptyHero });
  createDiceView(panels.get(TABS.dice.id), { store, log, openCheck, actorName });
  createLogView(panels.get(TABS.log.id), log);

  const tabBar = createTabBar(tabs, panels);
  setChildren(
    document.getElementById('app'),
    header.element,
    h('main', { class: 'app-main' }, [...panels.values()]),
    tabBar.element,
  );

  return {
    panel: (id) => panels.get(id),
    selectTab: tabBar.select,
    setStatus: header.setStatus,
    refreshHeader: header.refresh,
    /** Held-Tab neu aufbauen (z. B. wenn sich der Inhalt ohne Held ändert). */
    renderSheet: sheet.render,
  };
}
