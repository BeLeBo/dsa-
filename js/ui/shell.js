/**
 * shell.js – Rahmen der App: Tabs unten (mit Menü und Speicherstatus) und die Ansichten Held,
 * Würfeln, Protokoll (im Raum zusätzlich Karte und Gruppe). Eine Kopfzeile gibt es nicht – der
 * Platz gehört Karte und Bogen; Held, Raum und Status stehen im Menü und im Fenstertitel.
 * Wird vom Modus „Ohne Raum“ und vom Raum-Modus gleichermaßen genutzt.
 */
import { h, icon, setChildren, ICONS } from './dom.js';
import { showError } from './toast.js';
import { openMenu } from './menu.js';
import { openCheckDialog } from './check-dialog.js';
import { createSheetView } from './sheet/view.js';
import { createDiceView } from './dice-view.js';
import { createLogView } from './protocol-view.js';
import { readJson, writeJson } from '../storage.js';
import { heroName } from '../sheet.js';

const TAB_KEY = 'dsa5.ui.tab';

export const TABS = Object.freeze({
  hero: { id: 'held', name: 'Held', icon: ICONS.hero },
  dice: { id: 'wuerfeln', name: 'Würfeln', icon: ICONS.dice },
  log: { id: 'protokoll', name: 'Protokoll', icon: ICONS.log },
  map: { id: 'karte', name: 'Karte', icon: ICONS.map },
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

/**
 * Menü-Knopf (letzter in der Tab-Leiste) mit dem Speicherstatus als farbigem Punkt: grün gespeichert,
 * gelb beim Speichern, rot offline oder bei Fehlern. Ausgeschrieben steht der Status im Menü.
 */
function createMenuButton(store, { title, subtitle, menu }) {
  let state = 'saved';
  const statusText = h('span', { class: 'visually-hidden' }, STATUS_TEXT.saved);
  const status = h('span', { class: 'save-status', dataset: { status: state } }, statusText);
  const element = h(
    'button',
    {
      type: 'button',
      class: 'tab-menu',
      'aria-label': 'Menü öffnen',
      title: `Menü – ${STATUS_TEXT.saved}`,
      onclick: () => {
        const info = [store.hero ? heroName(store.hero) : title(), subtitle(), STATUS_TEXT[state] ?? state];
        openMenu({ ...menu(), info: info.filter(Boolean) });
      },
    },
    icon(ICONS.menu),
    h('span', { class: 'tab-label' }, 'Menü'),
    status,
  );

  /** Fenstertitel: geöffneter Held, sonst der Titel des Modus. */
  function refresh() {
    document.title = `${store.hero ? heroName(store.hero) : title()} – DSA5`;
  }

  function setStatus(next) {
    state = next;
    status.dataset.status = next;
    statusText.textContent = STATUS_TEXT[next] ?? next;
    element.title = `Menü – ${STATUS_TEXT[next] ?? next}`;
  }

  store.subscribe(refresh);
  refresh();
  return { element, setStatus, refresh };
}

function createTabBar(tabs, panels, initialTab = null, extra = null) {
  const buttons = new Map();
  const badges = new Map();
  const unseen = new Map();

  /** Zähler am Tab (z. B. neue Würfe im Protokoll); 0 blendet ihn aus. */
  function setBadge(id, count) {
    unseen.set(id, count);
    const badge = badges.get(id);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count <= 0;
  }

  /** Meldet etwas Neues in einem Tab, das gerade nicht offen ist. */
  function notify(id) {
    if (panels.get(id).hidden) setBadge(id, (unseen.get(id) ?? 0) + 1);
  }

  function select(id) {
    const target = tabs.some((tab) => tab.id === id) ? id : tabs[0].id;
    for (const tab of tabs) {
      const active = tab.id === target;
      panels.get(tab.id).hidden = !active;
      buttons.get(tab.id).setAttribute('aria-selected', String(active));
    }
    setBadge(target, 0);
    writeJson(TAB_KEY, target);
    window.scrollTo(0, 0);
  }

  const list = h(
    'div',
    { class: 'tab-list', role: 'tablist', 'aria-label': 'Bereiche' },
    tabs.map((tab) => {
      const badge = h('span', { class: 'tab-badge', hidden: true, 'aria-label': 'neu' });
      const button = h(
        'button',
        { type: 'button', role: 'tab', 'aria-controls': `tab-${tab.id}`, onclick: () => select(tab.id) },
        icon(tab.icon),
        h('span', { class: 'tab-label' }, tab.name),
        badge,
      );
      buttons.set(tab.id, button);
      badges.set(tab.id, badge);
      return button;
    }),
  );
  list.style.setProperty('--tabs', String(tabs.length)); // gleich breite Knöpfe samt Menü
  const element = h('nav', { class: 'tab-bar' }, list, extra);
  select(initialTab ?? readJson(TAB_KEY, tabs[0].id));
  return { element, select, notify };
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
 * @param {object} [options.rollOptions]        { visibility, canSeeSecret() } – siehe Probendialog
 * @param {() => Node} options.renderEmptyHero Inhalt des Held-Tabs ohne Held
 * @param {string} [options.initialTab]         Tab beim Start (sonst der zuletzt benutzte)
 * @param {() => object} options.menu     Menüeinträge (siehe menu.js)
 */
export function createShell({
  store,
  log,
  tabs,
  title,
  subtitle = () => null,
  actorName,
  renderEmptyHero,
  menu,
  rollOptions = {},
  initialTab = null,
}) {
  const menuButton = createMenuButton(store, { title, subtitle, menu });
  const panels = new Map(
    tabs.map((tab) => [tab.id, h('section', { id: `tab-${tab.id}`, class: 'tab-panel', role: 'tabpanel' })]),
  );

  const openCheck = (spec) => {
    try {
      openCheckDialog({ store, log, rollOptions }, spec);
    } catch (error) {
      showError(error, 'Probe nicht möglich');
    }
  };

  const sheetRoot = h('div', { class: 'sheet' });
  panels.get(TABS.hero.id).append(sheetRoot);
  const sheet = createSheetView(sheetRoot, store, { openCheck, renderEmpty: renderEmptyHero });
  createDiceView(panels.get(TABS.dice.id), { store, log, openCheck, actorName, rollOptions });
  createLogView(panels.get(TABS.log.id), log);

  const tabBar = createTabBar(tabs, panels, initialTab, menuButton.element);
  // Neue Würfe anderer zählen, solange das Protokoll nicht offen ist.
  log.subscribe((entries, change) => {
    if (change?.remote) tabBar.notify(TABS.log.id);
  });
  setChildren(document.getElementById('app'), h('main', { class: 'app-main' }, [...panels.values()]), tabBar.element);

  return {
    panel: (id) => panels.get(id),
    /** Probendialog für den geöffneten Helden (z. B. von der Karte aus). */
    openCheck,
    selectTab: tabBar.select,
    /** Zähler an einem Tab erhöhen, wenn er gerade nicht offen ist. */
    notifyTab: tabBar.notify,
    setStatus: menuButton.setStatus,
    /** Fenstertitel auffrischen (z. B. nach Wechsel des Raums oder der Rolle). */
    refreshTitle: menuButton.refresh,
    /** Held-Tab neu aufbauen (z. B. wenn sich der Inhalt ohne Held ändert). */
    renderSheet: sheet.render,
  };
}
