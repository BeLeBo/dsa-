/**
 * mode-room.js – Spielen im Raum: Helden, Würfelprotokoll, Kampf und Karte liegen auf dem
 * Server und werden live geteilt.
 *
 * Ablauf: anonym anmelden → Mitgliedschaft, Helden und Protokoll laden → eigenen Helden
 * (Spieler) bzw. zuletzt geöffneten Helden (Meister) öffnen → Live-Abo starten.
 * Ohne Verbindung wird der zuletzt gespeicherte Stand vom Gerät gezeigt.
 */
import { createShell, TABS } from './ui/shell.js';
import { createGroupView } from './ui/group-view.js';
import { createMapView } from './ui/map-view.js';
import { renderHeroChoice } from './ui/hero-choice.js';
import { showToast, showError } from './ui/toast.js';
import { confirmDialog } from './ui/dialog.js';
import { downloadHero, pickHeroFile, showImportReport } from './ui/hero-file.js';
import { createHeroStore, createObservable } from './store.js';
import { VISIBILITY, VISIBILITY_LABELS } from './log.js';
import { createRoomLog } from './room-log.js';
import { createCombatController } from './room-combat.js';
import { createMapController } from './room-map.js';
import { subscribeToMapChanges } from './map-api.js';
import { describeOutcome } from './format.js';
import { ensureUser } from './supabase.js';
import {
  ROLES,
  ROLE_NAMES,
  saveRoomSession,
  clearRoomSession,
  fetchRoster,
  fetchMembers,
  leaveRoom,
  assignCharacter,
  inviteLink,
} from './room.js';
import {
  createCharacterSync,
  createCharacter,
  deleteCharacter,
  fetchCharacter,
  saveCharacterData,
  subscribeToRoom,
  readCachedCharacter,
} from './sync.js';
import { normalizeHero, heroName } from './sheet.js';
import { isPlainObject, isOlderTimestamp } from './util.js';
import { toInt, clampConditionLevel } from './rules.js';
import { toggleKey } from './check-search.js';
import { heroEntryId } from './combat.js';
import { readLocalHero } from './mode-local.js';

/** Wartezeit bis zum nächsten Verbindungsversuch, wenn der Server nicht erreichbar ist. */
const RECONNECT_DELAY_MS = 30000;

function upsertById(list, row) {
  const index = list.findIndex((entry) => entry.id === row.id);
  return index === -1 ? [...list, row] : list.map((entry, position) => (position === index ? row : entry));
}

/**
 * Startet den Raum-Modus.
 * @param {object} initialSession  gespeicherte Sitzung (siehe room.js)
 * @param {object} options { onLeave(message) – zurück zur Startseite }
 */
export function startRoomMode(initialSession, { onLeave }) {
  let session = { ...initialSession };
  let sync = null;
  let stopLive = null;
  let stopMapLive = null;
  let connecting = false;
  let connected = false;
  let retryTimer = null;
  let logClearedAt = null;
  const store = createHeroStore(null);
  const room = createObservable({ session, members: [], characters: [], live: false, combat: null });
  const view = { state: 'connecting', error: '' };

  const isMaster = () => session.role === ROLES.MASTER;

  const log = createRoomLog({
    roomId: session.roomId,
    context: () => ({ isMaster: isMaster(), userId: session.userId, characterId: sync?.id ?? null }),
    onError: (error) => showError(error, 'Wurf nicht im Protokoll gespeichert'),
  });

  /** Heldendaten zu einer ID: geöffneter Held aus dem Speicher, sonst aus der Gruppenliste. */
  /**
   * Änderungen des Meisters, die noch auf dem Weg zum Server sind (je Held, in Reihenfolge).
   * Sie liegen über jedem Stand, der vom Server kommt – so springt die Anzeige bei schnellen
   * Tipps nicht kurz auf einen Zwischenstand zurück.
   */
  const pendingHeroChanges = new Map();

  /** Ist die Zeile älter als die schon angezeigte (verspätete Live-Meldung)? */
  function isOlderRow(row, shown) {
    return isOlderTimestamp(row?.updated_at, shown?.updated_at);
  }
  function withPendingChanges(row) {
    const pending = row ? pendingHeroChanges.get(row.id) : null;
    if (!pending?.length || !isPlainObject(row.data)) return row;
    const hero = normalizeHero(row.data);
    for (const mutate of pending) mutate(hero);
    return { ...row, data: hero };
  }

  function heroFor(characterId) {
    if (sync?.id === characterId) return store.hero;
    const row = room.get().characters.find((character) => character.id === characterId);
    return row ? normalizeHero(row.data) : null;
  }

  const combat = createCombatController({
    roomId: session.roomId,
    room,
    log,
    isMaster,
    heroFor,
    myCharacterId: () => (isMaster() ? null : (sync?.id ?? null)),
    onYourTurn: (message) => {
      showToast(message, { duration: 8000 });
      navigator.vibrate?.(200);
    },
    onError: (error) => showError(error, 'Kampf nicht gespeichert'),
  });

  // Neue Würfe: Initiative in den Kampf übernehmen; Meister erfährt verdeckte Würfe sofort.
  log.subscribe((entries, change) => {
    const record = change?.added;
    if (!record) return;
    combat.handleRecord(record);
    if (change.remote && isMaster() && record.visibility !== VISIBILITY.PUBLIC) {
      const { text } = describeOutcome(record.result);
      showToast(`${record.actor} (${VISIBILITY_LABELS[record.visibility]}): ${record.label} – ${text}`, {
        duration: 10000,
      });
    }
  });

  const shell = createShell({
    store,
    log,
    // Die Karte ist der Spielbildschirm. Wer noch keinen Helden hat, beginnt im Held-Tab (anlegen).
    tabs: [TABS.map, TABS.hero, TABS.dice, TABS.log, TABS.group],
    initialTab: isMaster() || session.characterId ? TABS.map.id : TABS.hero.id,
    title: () => session.name || `Raum ${session.code}`,
    subtitle: () => `${session.name ? `${session.name} · ` : ''}${session.code} · ${ROLE_NAMES[session.role]}`,
    actorName: () => (store.hero ? heroName(store.hero) : session.displayName),
    renderEmptyHero: () =>
      renderHeroChoice({
        state: view.state,
        isMaster: isMaster(),
        localHero: readLocalHero(),
        errorMessage: view.error,
        onCreate: createOwnCharacter,
        onRetry: connect,
        onShowGroup: () => shell.selectTab(TABS.group.id),
      }),
    menu: () => ({
      items: menuItems(),
      note: 'Änderungen werden automatisch gespeichert und live mit dem Raum geteilt.',
    }),
    rollOptions: { visibility: true, canSeeSecret: isMaster },
  });

  const mapController = createMapController({
    roomId: session.roomId,
    isMaster,
    characters: () => room.get().characters,
    onShown: (map) => {
      shell.notifyTab(TABS.map.id);
      showToast(`Der Meister zeigt jetzt eine Karte: „${map.name || 'Karte'}“.`, {
        action: { label: 'Ansehen', onClick: () => shell.selectTab(TABS.map.id) },
      });
    },
    // Ping des Meisters: kurz vibrieren; wer gerade nicht auf der Karte ist, bekommt eine Meldung.
    onPing: () => {
      navigator.vibrate?.(80);
      if (!shell.panel(TABS.map.id).hidden) return;
      shell.notifyTab(TABS.map.id);
      showToast('📍 Der Meister markiert eine Stelle auf der Karte.', {
        action: { label: 'Ansehen', onClick: () => shell.selectTab(TABS.map.id) },
      });
    },
    onError: (error) => showError(error, 'Karte'),
  });

  // -------------------------------------------------------------------------
  // Zustand
  // -------------------------------------------------------------------------

  function updateSession(changes) {
    session = { ...session, ...changes };
    saveRoomSession(session);
    room.update({ session });
    shell.refreshHeader();
  }

  function setViewState(state, error = '') {
    view.state = state;
    view.error = error;
    if (!store.hero) shell.renderSheet();
  }

  function leaveLocally(message) {
    stopLive?.();
    stopMapLive?.();
    clearRoomSession();
    onLeave(message);
  }

  async function run(label, action) {
    try {
      await action();
    } catch (error) {
      showError(error, label);
    }
  }

  // -------------------------------------------------------------------------
  // Helden öffnen und schließen
  // -------------------------------------------------------------------------

  function onSyncStatus(status, error) {
    shell.setStatus(status);
    if (status === 'error' && error) showError(error, 'Speichern fehlgeschlagen');
  }

  async function openCharacter(row) {
    if (sync?.id === row.id) {
      sync.applyRemote(row.data);
      return;
    }
    if (sync) await sync.dispose();
    sync = createCharacterSync({ id: row.id, store, serverData: row.data, onStatus: onSyncStatus });
    updateSession({ characterId: row.id });
  }

  async function closeCharacter(message = '') {
    if (sync) await sync.dispose({ save: false });
    sync = null;
    store.replace(null);
    updateSession({ characterId: null });
    shell.setStatus('online');
    if (message) showToast(message);
  }

  async function createOwnCharacter(heroData) {
    const row = await createCharacter(session.roomId, normalizeHero(heroData));
    room.update({ characters: upsertById(room.get().characters, row) });
    await openCharacter(row);
    showToast(`„${heroName(store.hero)}“ ist jetzt im Raum.`);
  }

  async function openInitialCharacter(characters) {
    const preferred = isMaster()
      ? characters.find((character) => character.id === session.characterId)
      : characters.find((character) => character.owner_id === session.userId);
    if (preferred) await openCharacter(preferred);
    else if (sync) await closeCharacter('Dieser Held ist nicht mehr verfügbar.');
  }

  /** Ohne Verbindung: zuletzt gespeicherten Stand vom Gerät zeigen. */
  function openFromCache() {
    const id = session.characterId;
    const cached = id ? readCachedCharacter(id) : null;
    if (!cached) return false;
    sync ??= createCharacterSync({ id, store, serverData: cached.synced, onStatus: onSyncStatus });
    showToast('Offline – du siehst den zuletzt gespeicherten Stand. Änderungen werden später übertragen.');
    return true;
  }

  // -------------------------------------------------------------------------
  // Verbindung und Live-Änderungen
  // -------------------------------------------------------------------------

  /** Lädt Mitglieder und Helden neu; null, wenn man nicht (mehr) Mitglied ist. */
  async function refreshRoster() {
    const roster = await fetchRoster(session.roomId);
    if (!roster.room) {
      leaveLocally('Du bist nicht (mehr) Mitglied dieses Raums. Bitte tritt erneut bei.');
      return null;
    }
    const me = roster.members.find((member) => member.user_id === session.userId);
    if (me && me.role !== session.role) updateSession({ role: me.role });
    room.update({
      members: roster.members,
      characters: roster.characters.map(withPendingChanges),
      combat: roster.room.combat ?? null,
    });
    logClearedAt = roster.room.log_cleared_at;
    mapController.handleRoomRow(roster.room);
    return roster;
  }

  /** Raum geändert (Kampf, Protokoll geleert, andere Karte gezeigt, Ping). */
  function handleRoomRow(row) {
    combat.handleRoomRow(row);
    mapController.handleRoomRow(row, { live: true });
    if (Object.hasOwn(row, 'log_cleared_at') && row.log_cleared_at !== logClearedAt) {
      logClearedAt = row.log_cleared_at;
      log.load().catch(() => {});
    }
  }

  /** Live-Meldungen enthalten große Spalten nicht immer (z. B. bei reiner Besitzer-Änderung) – dann nachladen. */
  async function completeRow(row) {
    return isPlainObject(row?.data) ? row : fetchCharacter(row.id);
  }

  async function handleCharacterRow(incoming) {
    const row = await completeRow(incoming).catch(() => null);
    if (!row) return;
    const shown = room.get().characters.find((character) => character.id === row.id);
    // Eine verspätete Live-Meldung darf einen neueren Stand nicht überschreiben.
    if (!isOlderRow(row, shown)) {
      room.update({ characters: upsertById(room.get().characters, withPendingChanges(row)) });
    }
    if (sync?.id === row.id) {
      sync.applyRemote(row.data);
    } else if (!isMaster() && !sync && row.owner_id === session.userId) {
      await openCharacter(row);
      showToast('Dir wurde ein Held zugewiesen.');
    }
  }

  function handleCharacterDeleted(id) {
    if (!id) return;
    room.update({ characters: room.get().characters.filter((character) => character.id !== id) });
    if (sync?.id === id) closeCharacter('Dieser Held wurde gelöscht.');
  }

  async function startLive() {
    stopLive?.();
    stopLive = await subscribeToRoom(session.roomId, {
      onCharacter: handleCharacterRow,
      onCharacterDeleted: handleCharacterDeleted,
      onMembersChanged: () =>
        fetchMembers(session.roomId)
          .then((members) => room.update({ members }))
          .catch(() => {}),
      onRoll: (row) => log.receive(row),
      onRoom: handleRoomRow,
      onReconnect: () => {
        sync?.resync();
        refreshRoster().catch(() => {});
        log.load().catch(() => {});
      },
      onLive: (live) => room.update({ live }),
    });
  }

  /** Karte: eigener Kanal – scheitert er (z. B. Schema veraltet), läuft der Rest trotzdem. */
  async function startMapLive() {
    stopMapLive?.();
    stopMapLive = await subscribeToMapChanges(session.roomId, {
      onMap: mapController.handleMapRow,
      onMapDeleted: mapController.handleMapDeleted,
      onToken: mapController.handleTokenRow,
      onTokenDeleted: mapController.handleTokenDeleted,
      onReconnect: mapController.load,
    }).catch(() => null);
  }

  function handleConnectError(error) {
    if (error.offline) {
      shell.setStatus('offline');
      mapController.markOffline();
      if (!sync && !openFromCache()) setViewState('offline');
      retryTimer = setTimeout(connect, RECONNECT_DELAY_MS); // auch wenn nur der Server nicht erreichbar ist
      return;
    }
    shell.setStatus('error');
    setViewState('error', error.message);
    if (store.hero) showError(error, 'Verbindung fehlgeschlagen');
  }

  async function connect() {
    if (connecting || connected) return;
    connecting = true;
    clearTimeout(retryTimer);
    setViewState('connecting');
    shell.setStatus('connecting');
    try {
      const userId = await ensureUser();
      if (session.userId && session.userId !== userId) {
        leaveLocally('Die Anmeldung auf diesem Gerät ist abgelaufen. Bitte tritt dem Raum erneut bei.');
        return;
      }
      updateSession({ userId });
      const roster = await refreshRoster();
      if (!roster) return;
      updateSession({ name: roster.room.name });
      setViewState('ready');
      await openInitialCharacter(roster.characters);
      if (!sync) shell.setStatus('online');
      await startLive();
      await log.load();
      await startMapLive();
      await mapController.load();
      connected = true;
    } catch (error) {
      handleConnectError(error);
    } finally {
      connecting = false;
    }
  }

  // -------------------------------------------------------------------------
  // Aktionen (Gruppe & Menü)
  // -------------------------------------------------------------------------

  async function share() {
    const url = inviteLink(session.code);
    const text = `Komm in meinen DSA5-Raum! Code: ${session.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'DSA5 am Spieltisch', text, url });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast('Einladungslink kopiert.');
    } catch {
      showToast(`Einladungslink: ${url}`, { duration: 20000 });
    }
  }

  async function leave() {
    const question = 'Raum auf diesem Gerät verlassen? Dein Held bleibt im Raum gespeichert.';
    if (!(await confirmDialog(question, { confirmLabel: 'Verlassen', danger: true }))) return;
    try {
      await sync?.flush();
      await leaveRoom(session);
    } catch (error) {
      if (!error.offline) {
        showError(error, 'Verlassen fehlgeschlagen');
        return;
      }
    }
    leaveLocally('');
  }

  async function replaceFromFile() {
    const picked = await pickHeroFile();
    if (!picked) return;
    const question = `„${heroName(store.hero)}“ durch „${heroName(picked.hero)}“ aus der Datei ersetzen?`;
    if (!(await confirmDialog(question, { confirmLabel: 'Ersetzen', danger: true }))) return;
    store.replace(picked.hero);
    showImportReport(picked.report);
  }

  /**
   * Meister: Werte eines Helden direkt ändern (Übersicht „Gruppe“, Panel auf der Karte).
   * Ist der Held geöffnet, geht es über den Heldenbogen (mit Abgleich). Sonst sofort in der
   * Anzeige, und auf dem Server nacheinander: neuester Stand laden, ändern, speichern –
   * so geht bei schnellen Tipps nichts verloren und Änderungen der Spieler bleiben erhalten.
   * @param {(hero: object) => void} mutate  ändert den (normalisierten) Helden
   */
  let heroQueue = Promise.resolve();
  function changeHero(characterId, mutate) {
    if (sync?.id === characterId) {
      mutate(store.hero);
      store.changed('value', null);
      return;
    }
    const pending = pendingHeroChanges.get(characterId) ?? [];
    pending.push(mutate);
    pendingHeroChanges.set(characterId, pending);
    const done = () => {
      pending.splice(pending.indexOf(mutate), 1);
      if (pending.length === 0 && pendingHeroChanges.get(characterId) === pending) {
        pendingHeroChanges.delete(characterId);
      }
    };
    const shown = room.get().characters.find((character) => character.id === characterId);
    if (shown) {
      const preview = normalizeHero(shown.data);
      mutate(preview);
      room.update({ characters: upsertById(room.get().characters, { ...shown, data: preview }) });
    }
    heroQueue = heroQueue
      .then(async () => {
        const row = await fetchCharacter(characterId);
        if (!row) return done();
        const hero = normalizeHero(row.data);
        mutate(hero);
        const saved = await saveCharacterData(characterId, hero);
        done();
        const fresh = { ...row, data: hero, updated_at: saved?.updated_at ?? row.updated_at };
        room.update({ characters: upsertById(room.get().characters, withPendingChanges(fresh)) });
      })
      .catch(async (error) => {
        done();
        showError(error, 'Ändern fehlgeschlagen');
        const row = await fetchCharacter(characterId).catch(() => null); // Anzeige wieder auf Serverstand
        if (row) room.update({ characters: upsertById(room.get().characters, withPendingChanges(row)) });
      });
  }

  const heroActions = {
    // Aus „−1“ wird gleich der Zielwert (angezeigter Stand − 1): So lässt sich die Änderung
    // gefahrlos über jeden Serverstand legen, auch über einen, der sie schon enthält.
    adjustPool: (characterId, key, delta) => {
      const shown = heroFor(characterId);
      if (!shown) return;
      const target = toInt(shown.base[key].current) + delta;
      changeHero(characterId, (hero) => {
        hero.base[key].current = target;
      });
    },
    setPool: (characterId, key, value) =>
      changeHero(characterId, (hero) => {
        hero.base[key].current = toInt(value);
      }),
    setCondition: (characterId, id, level) =>
      changeHero(characterId, (hero) => {
        hero.conditions[id] = clampConditionLevel(level);
      }),
    /** Probe als Favorit merken/vergessen – gleich als Zielzustand, damit doppeltes Anwenden nichts ändert. */
    toggleFavorite: (characterId, key) => {
      const shown = heroFor(characterId);
      if (!shown) return;
      const target = toggleKey(shown.favorites, key);
      changeHero(characterId, (hero) => {
        hero.favorites = target;
      });
    },
    open: (id) =>
      run('Öffnen fehlgeschlagen', async () => {
        const row = room.get().characters.find((character) => character.id === id);
        if (!row) return;
        await openCharacter(row);
        shell.selectTab(TABS.hero.id);
      }),
  };

  function menuItems() {
    const heroItems = store.hero
      ? [
          { label: 'Held exportieren (JSON-Sicherung)', onClick: () => downloadHero(store.hero) },
          { label: 'Held aus Datei ersetzen (Sicherung oder Optolith) …', onClick: replaceFromFile },
        ]
      : [];
    return [
      ...heroItems,
      { label: 'Einladung teilen', onClick: share },
      { label: 'Raum verlassen', danger: true, onClick: leave },
    ];
  }

  createMapView(shell.panel(TABS.map.id), {
    controller: mapController,
    room,
    isMaster,
    myCharacterId: () => (isMaster() ? null : (sync?.id ?? null)),
    heroFor,
    heroActions,
    subscribeHero: (listener) => store.subscribe(listener),
    store,
    openHeroId: () => sync?.id ?? null,
    openCheck: shell.openCheck,
    log,
    combatActions: combat.actions,
    showProtocol: () => shell.selectTab(TABS.log.id),
  });

  // Kampf beginnt: Spieler mit Held sollen ihre Initiative würfeln – auch aus einem anderen Tab.
  let combatRunning = Boolean(room.get().combat);
  room.subscribe(() => {
    const current = room.get().combat;
    const started = Boolean(current) && !combatRunning;
    combatRunning = Boolean(current);
    if (!started || isMaster() || !sync) return;
    if (current.entries.some((entry) => entry.id === heroEntryId(sync.id))) return;
    showToast('⚔ Kampf! Würfle deine Initiative.', {
      duration: 20000,
      action: { label: 'Würfeln', onClick: () => shell.openCheck({ kind: 'initiative' }) },
    });
    navigator.vibrate?.([100, 60, 100]);
  });

  createGroupView(shell.panel(TABS.group.id), {
    room,
    currentCharacterId: () => sync?.id ?? null,
    combatActions: combat.actions,
    actions: {
      share,
      leave,
      adjustPool: heroActions.adjustPool,
      open: heroActions.open,
      assign: (characterId, userId) =>
        run('Übergeben fehlgeschlagen', async () => {
          await assignCharacter(characterId, userId);
          await refreshRoster();
          showToast('Held übergeben.');
        }),
      remove: (id) =>
        run('Löschen fehlgeschlagen', async () => {
          if (sync?.id === id) await closeCharacter();
          await deleteCharacter(id);
          room.update({ characters: room.get().characters.filter((character) => character.id !== id) });
          showToast('Held gelöscht.');
        }),
    },
  });

  // Beim Verlassen oder Wechseln der App sofort speichern; beim Zurückkehren abgleichen.
  window.addEventListener('online', () => {
    connect();
    log.flushPending();
  });
  window.addEventListener('pagehide', () => sync?.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sync?.flush();
    else sync?.resync();
  });

  connect();
}
