/**
 * hero-choice.js – Inhalt des Held-Tabs, solange kein Held geöffnet ist:
 * Held anlegen (neu, vom Gerät übernehmen, aus Datei), Hinweise für den Meister,
 * Verbindungs- und Fehlerzustände.
 */
import { h } from './dom.js';
import { pickHeroFile } from './hero-file.js';
import { createHero, heroName } from '../sheet.js';

function card(title, ...content) {
  return h('section', { class: 'card choice-card' }, h('h2', {}, title), content);
}

/**
 * @param {object} options
 * @param {'connecting'|'ready'|'offline'|'error'} options.state
 * @param {boolean} options.isMaster
 * @param {object|null} options.localHero   Held aus dem Modus „Ohne Raum“ auf diesem Gerät
 * @param {string} [options.errorMessage]
 * @param {(heroData: object) => Promise} options.onCreate
 * @param {() => void} options.onRetry
 * @param {() => void} options.onShowGroup
 */
export function renderHeroChoice({ state, isMaster, localHero, errorMessage, onCreate, onRetry, onShowGroup }) {
  if (state === 'connecting') {
    return card('Verbinde mit dem Raum …', h('p', { class: 'section-hint' }, 'Einen Moment bitte.'));
  }
  if (state === 'offline') {
    return card(
      'Offline',
      h(
        'p',
        {},
        'Dein Held ist auf diesem Gerät noch nicht gespeichert. Sobald du wieder online bist, geht es weiter.',
      ),
      h('button', { type: 'button', class: 'btn', onclick: onRetry }, 'Erneut versuchen'),
    );
  }
  if (state === 'error') {
    return card(
      'Verbindung fehlgeschlagen',
      h('p', { class: 'error-text' }, errorMessage),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onRetry }, 'Erneut versuchen'),
    );
  }

  const status = h('p', { class: 'error-text', hidden: true, role: 'alert' });
  const create = async (loadHero) => {
    status.hidden = true;
    try {
      const hero = await loadHero();
      if (hero) await onCreate(hero);
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
    }
  };

  const options = h(
    'div',
    { class: 'menu-list' },
    h(
      'button',
      { type: 'button', class: 'btn btn-primary', onclick: () => create(() => createHero()) },
      'Neuen Helden anlegen',
    ),
    localHero
      ? h(
          'button',
          { type: 'button', class: 'btn', onclick: () => create(() => localHero) },
          `„${heroName(localHero)}“ von diesem Gerät übernehmen`,
        )
      : null,
    h('button', { type: 'button', class: 'btn', onclick: () => create(pickHeroFile) }, 'Helden aus Datei laden (JSON)'),
  );

  if (isMaster) {
    return card(
      'Kein Held geöffnet',
      h('p', {}, 'Als Meister wählst du unter „Gruppe“ einen Helden aus, um ihn zu sehen und zu bearbeiten.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: onShowGroup }, 'Zur Gruppe'),
      h('h3', {}, 'Oder eigenen Helden anlegen (z. B. NSC)'),
      options,
      status,
    );
  }
  return card(
    'Dein Held in diesem Raum',
    h('p', {}, 'Du hast hier noch keinen Helden.'),
    options,
    status,
    h(
      'p',
      { class: 'section-hint' },
      'Du spielst schon auf einem anderen Gerät? Dann kann der Meister dir deinen Helden unter „Gruppe“ zuweisen.',
    ),
  );
}
